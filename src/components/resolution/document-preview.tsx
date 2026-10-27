'use client';
import type { ResolvedBlock, ResolvedDocument, ResolvedInline } from '@/domain/resolution/model';
import type { Issue } from './api';

function Runs({ runs }: { runs: ResolvedInline[] }) {
  return (
    <>
      {runs.map((run, index) => {
        if ('break' in run) return <br key={index} />;
        let node: React.ReactNode = run.text;
        if (run.marks?.includes('underline')) node = <u>{node}</u>;
        if (run.marks?.includes('italic')) node = <em>{node}</em>;
        if (run.marks?.includes('bold')) node = <strong>{node}</strong>;
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: ResolvedBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <p
                key={index}
                style={{
                  textAlign: block.align,
                  marginLeft: block.indent ? `${block.indent * 2}em` : undefined,
                }}
                className={block.number ? 'numbered' : undefined}
              >
                {block.number ? <span className="clause-number">{block.number}</span> : null}
                <span>
                  <Runs runs={block.runs} />
                </span>
              </p>
            );
          case 'heading': {
            const Tag = (['h2', 'h3', 'h4'] as const)[block.level - 1];
            return (
              <Tag key={index} style={{ textAlign: block.align }}>
                <Runs runs={block.runs} />
              </Tag>
            );
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Blocks blocks={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div className="document-table" key={index}>
                <table>
                  {block.columnWidths ? (
                    <colgroup>
                      {block.columnWidths.map((width, i) => (
                        <col key={i} style={{ width: `${width}%` }} />
                      ))}
                    </colgroup>
                  ) : null}
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.cells.map((cell, c) =>
                          row.header ? (
                            <th key={c} scope="col">
                              <Blocks blocks={cell} />
                            </th>
                          ) : (
                            <td key={c}>
                              <Blocks blocks={cell} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'pageBreak':
            return (
              <div key={index} className="document-page-break" role="separator">
                <span>Page break</span>
              </div>
            );
          case 'signatures':
            return (
              <div key={index} className="document-signatures">
                {block.heading ? <p className="signature-heading">{block.heading}</p> : null}
                <div
                  className="signature-grid"
                  style={{ gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }}
                >
                  {block.signers.map((signer, i) => (
                    <div key={i} className="signature">
                      <div className="signature-line" />
                      <div>{signer.label || signer.name}</div>
                      {block.showDate ? <div className="signature-date">Date:</div> : null}
                    </div>
                  ))}
                </div>
                {!block.signers.length ? (
                  <p className="metadata">No signers selected for this role.</p>
                ) : null}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/** Page-like view of the same resolved document the DOCX renderer consumes. */
export function DocumentPreview({
  document,
  issues = [],
  onIssue,
}: {
  document: ResolvedDocument | null;
  issues?: Issue[];
  onIssue?: (issue: Issue) => void;
}) {
  return (
    <div className="document-preview">
      {issues.length ? (
        <div className="warning" role="alert">
          <strong>
            {issues.length} {issues.length === 1 ? 'issue' : 'issues'} to resolve
          </strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>
                {onIssue ? (
                  <button type="button" className="text-button" onClick={() => onIssue(issue)}>
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
                {issue.location ? <span className="metadata"> · {issue.location}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {document ? (
        <>
          <p className="metadata">
            Preview only. Word decides the final page breaks and pagination.
            {document.containsSamples ? ' Contains labelled sample values.' : ''}
          </p>
          <div className="document-scroll">
            <article
              className="document-page"
              aria-label={`Preview of ${document.title}`}
              style={{
                fontFamily: document.layout.fontFamily,
                fontSize: `${document.layout.fontSizePt}pt`,
                padding: `${document.layout.marginsMm.top}mm ${document.layout.marginsMm.right}mm ${document.layout.marginsMm.bottom}mm ${document.layout.marginsMm.left}mm`,
              }}
            >
              {document.layout.header ? (
                <div className="document-running">{document.layout.header}</div>
              ) : null}
              <Blocks blocks={document.blocks} />
              {document.layout.footer || document.layout.pageNumbers ? (
                <div className="document-running footer">
                  {document.layout.footer}
                  {document.layout.pageNumbers ? <span>Page 1 of N</span> : null}
                </div>
              ) : null}
            </article>
          </div>
        </>
      ) : null}
    </div>
  );
}
