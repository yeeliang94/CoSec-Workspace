'use client';
/** Tiptap nodes for the template editor. Their attributes mirror schema-v1 BlockNode fields. */
import { createContext, useContext } from 'react';
import {
  Extension,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from '@tiptap/react';
import { LIMITS } from '@/domain/resolution/schema';
import { Table } from '@tiptap/extension-table';
import type { FieldDefinition, Predicate } from '@/domain/resolution/model';
import { predicateSummary } from './fields';

export type EditorFieldsContext = {
  fields: FieldDefinition[];
  /** Selects a node and moves focus to its settings in the inspector. */
  onEdit: (pos: number) => void;
};
export const TemplateFieldsContext = createContext<EditorFieldsContext>({
  fields: [],
  onEdit: () => {},
});

const ROLE_LABELS: Record<string, string> = {
  directors: 'Directors',
  members: 'Members',
  certifiers: 'Certified true copy signers',
};
const PROPERTY_LABELS: Record<string, string> = {
  name: 'name',
  capacity: 'capacity',
  appointedOn: 'appointed on',
  ceasedOn: 'ceased on',
};

function json(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    templateIndent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/** Paragraph indentation (0–6 steps); lists use sink/lift instead. */
export const Indent = Extension.create({
  name: 'templateIndent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Number(element.getAttribute('data-indent')) || 0,
            renderHTML: (attributes) =>
              attributes.indent
                ? {
                    'data-indent': attributes.indent,
                    style: `margin-left: ${attributes.indent * 2}em`,
                  }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    const step =
      (delta: number) =>
      () =>
      ({ editor, chain }: { editor: import('@tiptap/react').Editor; chain: () => any }) => {
        if (editor.isActive('listItem'))
          return delta > 0
            ? chain().sinkListItem('listItem').run()
            : chain().liftListItem('listItem').run();
        const current = Number(editor.getAttributes('paragraph').indent ?? 0);
        const next = Math.min(LIMITS.indent, Math.max(0, current + delta));
        return chain().updateAttributes('paragraph', { indent: next }).run();
      };
    return { indent: step(1), outdent: step(-1) };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});

/** Table with stored percentage widths kept as an opaque attribute. */
export const TemplateTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      columnWidths: {
        default: null,
        parseHTML: (element) => json(element.getAttribute('data-column-widths')),
        renderHTML: (attributes) =>
          attributes.columnWidths
            ? { 'data-column-widths': JSON.stringify(attributes.columnWidths) }
            : {},
      },
    };
  },
}).configure({ resizable: false });

function FieldChipView({ node, selected, getPos }: NodeViewProps) {
  const { fields, onEdit } = useContext(TemplateFieldsContext);
  const field = fields.find((item) => item.id === node.attrs.fieldId);
  const property = node.attrs.property ? PROPERTY_LABELS[node.attrs.property] : '';
  const text = field
    ? field.label + (property ? ` · ${property}` : '')
    : `Unknown field ${node.attrs.fieldId}`;
  return (
    <NodeViewWrapper
      as="span"
      className={`field-chip${selected ? ' selected' : ''}${field ? '' : ' missing'}`}
      data-field-id={node.attrs.fieldId}
      title={field?.id}
      onDoubleClick={() => {
        const pos = getPos();
        if (typeof pos === 'number') onEdit(pos);
      }}
    >
      {text}
    </NodeViewWrapper>
  );
}

export const FieldChip = Node.create({
  name: 'field',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',
  addAttributes() {
    return {
      fieldId: { default: '', parseHTML: (element) => element.getAttribute('data-field-id') },
      property: { default: null, parseHTML: (element) => element.getAttribute('data-property') },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-field-id]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-field-id': node.attrs.fieldId,
        'data-property': node.attrs.property,
      }),
      `{${node.attrs.fieldId}}`,
    ];
  },
  renderText({ node }) {
    return `{${node.attrs.fieldId}}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(FieldChipView);
  },
});

function BlockHeader({
  title,
  getPos,
  editLabel,
}: {
  title: string;
  getPos: NodeViewProps['getPos'];
  editLabel: string;
}) {
  const { onEdit } = useContext(TemplateFieldsContext);
  return (
    <div className="template-block-header" contentEditable={false}>
      <span>{title}</span>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          const pos = getPos();
          if (typeof pos === 'number') onEdit(pos);
        }}
      >
        {editLabel}
      </button>
    </div>
  );
}

function ConditionView({ node, getPos, selected }: NodeViewProps) {
  const { fields } = useContext(TemplateFieldsContext);
  const when = node.attrs.when as Predicate | null;
  return (
    <NodeViewWrapper className={`template-block condition${selected ? ' selected' : ''}`}>
      <BlockHeader
        title={`Only when ${when ? predicateSummary(when, fields) : '… (rule not set)'}`}
        getPos={getPos}
        editLabel="Edit rule"
      />
      <NodeViewContent className="template-block-content" />
    </NodeViewWrapper>
  );
}

export const Condition = Node.create({
  name: 'condition',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      when: {
        default: null,
        parseHTML: (element) => json(element.getAttribute('data-when')),
        renderHTML: (attributes) => ({ 'data-when': JSON.stringify(attributes.when) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-condition]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-condition': '' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ConditionView);
  },
});

function RepeatView({ node, getPos, selected }: NodeViewProps) {
  const { fields } = useContext(TemplateFieldsContext);
  const field = fields.find((item) => item.id === node.attrs.fieldId);
  return (
    <NodeViewWrapper className={`template-block repeat${selected ? ' selected' : ''}`}>
      <BlockHeader
        title={`Repeat for each person in ${field?.label || node.attrs.fieldId || '… (list not set)'}`}
        getPos={getPos}
        editLabel="Edit repeat"
      />
      <NodeViewContent className="template-block-content" />
    </NodeViewWrapper>
  );
}

export const Repeat = Node.create({
  name: 'repeat',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      fieldId: { default: '', parseHTML: (element) => element.getAttribute('data-repeat') },
      emptyText: { default: null, parseHTML: (element) => element.getAttribute('data-empty') },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-repeat]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-repeat': node.attrs.fieldId,
        'data-empty': node.attrs.emptyText,
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RepeatView);
  },
});

function PageBreakView({ selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`template-atom page-break${selected ? ' selected' : ''}`}>
      <span contentEditable={false}>Page break</span>
    </NodeViewWrapper>
  );
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBreakView);
  },
});

function ClauseSlotView({ node, getPos, selected }: NodeViewProps) {
  const numbered = node.attrs.numbering === 'decimal';
  return (
    <NodeViewWrapper className={`template-atom clause-slot${selected ? ' selected' : ''}`}>
      <div contentEditable={false}>
        <BlockHeader
          title={`Selected clauses · ${numbered ? 'numbered 1, 2, 3' : 'not numbered'}`}
          getPos={getPos}
          editLabel="Edit numbering"
        />
        <ol className={numbered ? '' : 'unnumbered'} aria-label="Sample clauses">
          <li>The chosen paragraphs appear here, in the preparer&apos;s order.</li>
          <li>Each paragraph uses its wording for the chosen document type.</li>
        </ol>
      </div>
    </NodeViewWrapper>
  );
}

export const ClauseSlot = Node.create({
  name: 'clauseSlot',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      numbering: {
        default: 'decimal',
        parseHTML: (element) => element.getAttribute('data-numbering') || 'decimal',
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-clause-slot]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-clause-slot': '',
        'data-numbering': node.attrs.numbering,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ClauseSlotView);
  },
});

function SignatureBlockView({ node, getPos, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`template-atom signature-slot${selected ? ' selected' : ''}`}>
      <div contentEditable={false}>
        <BlockHeader
          title={`Signatures · ${ROLE_LABELS[node.attrs.role] || node.attrs.role}${node.attrs.heading ? ` · “${node.attrs.heading}”` : ''}`}
          getPos={getPos}
          editLabel="Edit signatures"
        />
        <div className="signature-sample" aria-hidden="true">
          <span>________________</span>
          <span>________________</span>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const SignatureBlock = Node.create({
  name: 'signatureBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      role: { default: 'directors', parseHTML: (element) => element.getAttribute('data-role') },
      heading: { default: null, parseHTML: (element) => element.getAttribute('data-heading') },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-signature-role]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-signature-role': node.attrs.role,
        'data-heading': node.attrs.heading,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SignatureBlockView);
  },
});

export { ROLE_LABELS, PROPERTY_LABELS };
