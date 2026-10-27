import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { auditChange } from '../resolution/shared';
import { assertCapability, assertCompany, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import { csvCell, isCalendarDate, type AuditEntryView } from '../../domain/resolution/records';

export type AuditFilters = {
  companyId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  /** Inclusive calendar dates in Asia/Kuala_Lumpur. */
  from?: string;
  to?: string;
};
export const AUDIT_PAGE_MAX = 100;
export const AUDIT_EXPORT_MAX = 5000;

/** Start of a Kuala Lumpur calendar day (UTC+8, no daylight saving) as a UTC SQL timestamp. */
function klDayStart(date: string, addDays = 0) {
  const at = new Date(`${date}T00:00:00+08:00`);
  at.setUTCDate(at.getUTCDate() + addDays);
  return at.toISOString().replace('T', ' ').replace('Z', '');
}
const list = (values: string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Firm-level (no company, no scope) entity types that template administrators may read. */
const TEMPLATE_ENTITIES = [
  'template',
  'template_version',
  'clause',
  'clause_template',
  'clause_version',
  'assembly',
  'assembly_version',
  'output_type',
  'record_field',
];
const PERSON_CREATOR = sql`(SELECT JSON_UNQUOTE(JSON_EXTRACT(p.data, '$.createdBy')) FROM people p
  WHERE p.id = a.subject_id)`;

/**
 * Firm-level rows by entity: templates and record fields for template administrators; people for
 * the person's creator or people managers (others' email and notes are redacted in the view);
 * an actor's own preferences and exports for that actor; users, settings and anything else for
 * user administrators.
 */
function firmLevel(actor: Actor): SQL {
  const has = (c: Actor['capabilities'][number]) => actor.capabilities.includes(c);
  const kinds: SQL[] = [];
  if (has('manage_templates')) kinds.push(sql`a.entity_type IN (${list(TEMPLATE_ENTITIES)})`);
  kinds.push(
    has('manage_people')
      ? sql`a.entity_type = 'person'`
      : sql`(a.entity_type = 'person' AND ${PERSON_CREATOR} = ${actor.id})`,
  );
  if (has('manage_users'))
    kinds.push(
      sql`(a.entity_type IS NULL OR a.entity_type NOT IN (${list(['person', ...TEMPLATE_ENTITIES])}))`,
    );
  else
    kinds.push(
      sql`(a.actor_id = ${actor.id} AND (a.action LIKE 'preferences.%' OR a.entity_type = 'audit'))`,
    );
  return sql`(a.company_id IS NULL AND (a.scope_company_ids IS NULL OR JSON_LENGTH(a.scope_company_ids) = 0)
    AND (${sql.join(kinds, sql` OR `)}))`;
}

/**
 * Rows the actor may read: their companies' rows, rows whose fixed scope overlaps their
 * companies, and firm-level rows by entity type (see `firmLevel`). Without `view_bo`, BO rows
 * and legacy rows about W06 jobs or BO documents are excluded.
 */
function visibility(actor: Actor): SQL {
  const has = (c: Actor['capabilities'][number]) => actor.capabilities.includes(c);
  const scopes: SQL[] = [];
  if (actor.companyIds.length) {
    scopes.push(sql`a.company_id IN (${list(actor.companyIds)})`);
    scopes.push(
      sql`(a.scope_company_ids IS NOT NULL AND JSON_OVERLAPS(a.scope_company_ids, CAST(${JSON.stringify(actor.companyIds)} AS JSON)))`,
    );
  }
  scopes.push(firmLevel(actor));
  const scope = scopes.length ? sql`(${sql.join(scopes, sql` OR `)})` : sql`FALSE`;
  if (has('view_bo')) return scope;
  return sql`${scope} AND a.sensitivity <> 'BO' AND a.action NOT LIKE 'bo.%'
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = a.subject_id
      AND JSON_UNQUOTE(JSON_EXTRACT(j.data, '$.activity')) = 'W06')
    AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = a.subject_id
      AND JSON_UNQUOTE(JSON_EXTRACT(d.data, '$.classification')) = 'BO')`;
}

function where(actor: Actor, f: AuditFilters): SQL {
  const parts: SQL[] = [visibility(actor)];
  if (f.companyId) {
    assertCompany(actor, f.companyId);
    parts.push(
      sql`(a.company_id = ${f.companyId} OR JSON_CONTAINS(COALESCE(a.scope_company_ids, JSON_ARRAY()), JSON_QUOTE(${f.companyId})))`,
    );
  }
  if (f.entityType) parts.push(sql`a.entity_type = ${f.entityType}`);
  if (f.entityId) parts.push(sql`a.subject_id = ${f.entityId}`);
  if (f.action) parts.push(sql`a.action = ${f.action}`);
  if (f.actorId) parts.push(sql`a.actor_id = ${f.actorId}`);
  for (const date of [f.from, f.to])
    if (date !== undefined && !isCalendarDate(date)) throw new DomainError('Choose valid dates.');
  if (f.from) parts.push(sql`a.created_at >= ${klDayStart(f.from)}`);
  if (f.to) parts.push(sql`a.created_at < ${klDayStart(f.to, 1)}`);
  return sql.join(parts, sql` AND `);
}

type Row = {
  id: string;
  ts: string;
  actorId: string;
  actorName: string | null;
  companyId: string | null;
  companyName: string | null;
  action: string;
  entityType: string | null;
  subjectId: string;
  reason: string | null;
  requestId: string | null;
  detail: unknown;
  scopeCompanyIds: unknown;
  personCreatedBy: string | null;
};
const REDACTED = '[redacted]';
const PRIVATE_PERSON_FIELDS = ['email', 'notes'];
/** Hides a person's email and notes, whether diffed as leaves or inside a whole-record value. */
function redactPerson(change: AuditEntryView['changes'][number]) {
  const top = change.path.split('.')[0];
  if (PRIVATE_PERSON_FIELDS.includes(top))
    return { path: change.path, before: REDACTED, after: REDACTED };
  const hide = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, PRIVATE_PERSON_FIELDS.includes(k) ? REDACTED : x]),
        )
      : v;
  return { path: change.path, before: hide(change.before), after: hide(change.after) };
}
function toView(actor: Actor, r: Row): AuditEntryView {
  const detail = (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail) as Record<
    string,
    unknown
  > | null;
  const { changes, ...rest } = (detail ?? {}) as { changes?: AuditEntryView['changes'] };
  const visibleCompany = r.companyId && actor.companyIds.includes(r.companyId);
  const scope = (
    typeof r.scopeCompanyIds === 'string' ? JSON.parse(r.scopeCompanyIds) : r.scopeCompanyIds
  ) as string[] | null;
  // A firm-level person row (an unlinked person) shows contact details only to its creator.
  const redact =
    r.entityType === 'person' && !r.companyId && !scope?.length && r.personCreatedBy !== actor.id;
  const shown = Array.isArray(changes) ? changes : [];
  return {
    id: r.id,
    at: `${r.ts.slice(0, 10)}T${r.ts.slice(11, 23)}Z`,
    actorId: r.actorId,
    actorName: r.actorName ?? (r.actorId === 'system' ? 'System' : 'Unknown user'),
    companyId: visibleCompany ? r.companyId : null,
    companyName: visibleCompany ? r.companyName : null,
    action: r.action,
    entityType: r.entityType,
    entityId: r.subjectId,
    reason: r.reason,
    requestId: r.requestId,
    changes: redact ? shown.map(redactPerson) : shown,
    summary: Object.keys(rest).length ? JSON.stringify(rest).slice(0, 500) : null,
  };
}

function encodeCursor(row: Row) {
  return Buffer.from(JSON.stringify([row.ts, row.id])).toString('base64url');
}
function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}$/.test(value[0]) &&
      typeof value[1] === 'string'
    )
      return value as [string, string];
  } catch {}
  throw new DomainError('This page link is no longer valid. Start from the first page.');
}

async function select(actor: Actor, filters: AuditFilters, limit: number, cursor?: string) {
  const conditions = [where(actor, filters)];
  if (cursor) {
    const [ts, id] = decodeCursor(cursor);
    conditions.push(sql`(a.created_at < ${ts} OR (a.created_at = ${ts} AND a.id < ${id}))`);
  }
  const [rows] = (await db.execute(sql`
    SELECT a.id, DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s.%f') AS ts, a.actor_id AS actorId,
      u.name AS actorName, a.company_id AS companyId,
      JSON_UNQUOTE(JSON_EXTRACT(c.data, '$.name')) AS companyName, a.action,
      a.entity_type AS entityType, a.subject_id AS subjectId, a.reason, a.request_id AS requestId,
      a.detail, a.scope_company_ids AS scopeCompanyIds,
      CASE WHEN a.entity_type = 'person' THEN ${PERSON_CREATOR} END AS personCreatedBy
    FROM audit_events a
    LEFT JOIN \`user\` u ON u.id = a.actor_id
    LEFT JOIN companies c ON c.id = a.company_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${limit}`)) as unknown as [Row[]];
  return rows;
}

export async function queryAudit(
  actor: Actor,
  filters: AuditFilters,
  page: { cursor?: string; limit?: number } = {},
) {
  assertCapability(actor, 'view_audit');
  const limit = Math.min(Math.max(page.limit ?? 50, 1), AUDIT_PAGE_MAX);
  const rows = await select(actor, filters, limit + 1, page.cursor);
  const [[{ total }]] = (await db.execute(
    sql`SELECT COUNT(*) AS total FROM audit_events a WHERE ${where(actor, filters)}`,
  )) as unknown as [[{ total: number | string }]];
  const pageRows = rows.slice(0, limit);
  return {
    entries: pageRows.map((r) => toView(actor, r)),
    nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : null,
    total: Number(total),
  };
}

const klTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  dateStyle: 'medium',
  timeStyle: 'medium',
});
/**
 * CSV of the visible, filtered entries (newest first), itself recorded in the audit. More than
 * AUDIT_EXPORT_MAX matches is refused rather than silently cut, so a file is always complete.
 */
export async function exportAudit(actor: Actor, filters: AuditFilters) {
  assertCapability(actor, 'view_audit');
  assertCapability(actor, 'export_audit');
  const rows = await select(actor, filters, AUDIT_EXPORT_MAX + 1);
  if (rows.length > AUDIT_EXPORT_MAX)
    throw new DomainError(
      `More than ${AUDIT_EXPORT_MAX.toLocaleString('en-MY')} entries match. Narrow the filters, for example by date or company, and export again.`,
      'TOO_LARGE',
    );
  const entries = rows.map((r) => toView(actor, r));
  const header = [
    'Time (UTC)',
    'Time (Kuala Lumpur)',
    'Actor',
    'Company',
    'Action',
    'Entity type',
    'Entity id',
    'Reason',
    'Request id',
    'Changes',
    'Summary',
  ];
  const lines = [
    header,
    ...entries.map((e) => [
      e.at,
      klTime.format(new Date(e.at)),
      e.actorName,
      e.companyName ?? '',
      e.action,
      e.entityType ?? '',
      e.entityId,
      e.reason ?? '',
      e.requestId ?? '',
      e.changes.length ? JSON.stringify(e.changes) : '',
      e.summary ?? '',
    ]),
  ].map((cells) => cells.map(csvCell).join(','));
  await db.transaction((tx) =>
    auditChange(tx, actor, {
      companyId: filters.companyId ?? null,
      scopeCompanyIds: filters.companyId ? [filters.companyId] : [],
      entityType: 'audit',
      entityId: 'export',
      action: 'audit.exported',
      detail: { filters, rowCount: entries.length },
    }),
  );
  return { csv: lines.join('\r\n') + '\r\n', rowCount: entries.length };
}
