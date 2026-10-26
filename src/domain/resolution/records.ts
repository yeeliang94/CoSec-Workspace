import { DomainError } from '../access';
import type { Capability, OfficerEvent } from '../model';
import type { CustomValues, DatedValue, RecordFieldDefinition } from './model';

export const FIELD_ID = /^[a-z][a-z0-9_]{1,63}$/;
export const OPTION_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;
const DECIMAL = /^-?\d{1,18}(\.\d{1,10})?$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** The value in force on `asAt`: the latest effective entry, later recordings winning ties. */
export function valueAt(values: DatedValue[] | undefined, asAt: string) {
  const inForce = (values ?? [])
    .filter((v) => v.effectiveDate <= asAt)
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) || a.recordedAt.localeCompare(b.recordedAt),
    );
  return inForce.length ? inForce[inForce.length - 1].value : undefined;
}
export function resolveValues(values: CustomValues | undefined, asAt: string) {
  const out: Record<string, string | boolean | null> = {};
  for (const [key, list] of Object.entries(values ?? {})) {
    const value = valueAt(list, asAt);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Checks a custom value against its definition; `null` clears the value from its effective date. */
export function validateFieldValue(
  definition: RecordFieldDefinition,
  value: unknown,
): string | boolean | null {
  const fail = (message: string): never => {
    throw new DomainError(`${definition.label}: ${message}`);
  };
  if (definition.archived) fail('this field is archived and cannot take new values.');
  if (value === null) return null;
  switch (definition.valueType) {
    case 'text':
      if (typeof value !== 'string' || value.length > 4000)
        fail('enter text up to 4,000 characters.');
      return (value as string).trim();
    case 'date':
      if (!isCalendarDate(value)) fail('enter a calendar date (YYYY-MM-DD).');
      return value as string;
    case 'number':
      if (typeof value !== 'string' || !DECIMAL.test(value))
        fail('enter an exact decimal number such as 1250.50.');
      return value as string;
    case 'boolean':
      if (typeof value !== 'boolean') fail('choose yes or no.');
      return value as boolean;
    case 'choice':
      if (typeof value !== 'string' || !definition.options?.some((o) => o.id === value))
        fail('choose one of the configured options.');
      return value as string;
  }
}

export type DirectorInterval = {
  personId: string;
  personName: string;
  startDate: string;
  endDate: string | null;
  officerEventIds: string[];
  appointmentEventId: string;
};
/**
 * Appointment/cessation intervals per person, in the same order `officersAt` applies events, so
 * the projection never disagrees with the as-at officer view. A repeated appointment while an
 * interval is open joins that interval; a cessation with no open interval is ignored.
 */
export function directorIntervals(events: OfficerEvent[]): DirectorInterval[] {
  const open = new Map<string, DirectorInterval>();
  const out: DirectorInterval[] = [];
  const ordered = [...events].sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.recordedAt.localeCompare(b.recordedAt) ||
      a.id.localeCompare(b.id),
  );
  for (const event of ordered) {
    const current = open.get(event.personId);
    if (event.route === 'appointment') {
      if (current) current.officerEventIds.push(event.id);
      else {
        const interval = {
          personId: event.personId,
          personName: event.personName,
          startDate: event.effectiveDate,
          endDate: null,
          officerEventIds: [event.id],
          appointmentEventId: event.id,
        };
        open.set(event.personId, interval);
        out.push(interval);
      }
    } else if (current) {
      current.endDate = event.effectiveDate;
      current.officerEventIds.push(event.id);
      open.delete(event.personId);
    }
  }
  return out;
}
/** Stable relationship id for the interval opened by one appointment event. */
export const directorRelationshipId = (appointmentEventId: string) =>
  `director-${appointmentEventId}`;

/**
 * Explicit mapping from existing capabilities to the resolution-builder capabilities. Nothing is
 * granted to a user who does not already hold a mapped capability.
 */
export function mappedResolutionCapabilities(current: Capability[]): Capability[] {
  const has = (c: Capability) => current.includes(c);
  const add = new Set<Capability>();
  if (has('manage_users') && has('manage_catalogue'))
    for (const c of [
      'manage_people',
      'manage_templates',
      'generate_documents',
      'view_audit',
      'export_audit',
    ] as const)
      add.add(c);
  if (has('prepare_job')) add.add('generate_documents');
  if (has('manage_catalogue')) add.add('manage_templates');
  if (has('confirm_record')) {
    add.add('manage_people');
    add.add('view_audit');
  }
  if (has('manage_users')) {
    add.add('view_audit');
    add.add('export_audit');
  }
  return [...add].filter((c) => !has(c));
}

export type AuditEntryView = {
  id: string;
  /** UTC ISO timestamp; display in Asia/Kuala_Lumpur. */
  at: string;
  actorId: string;
  actorName: string;
  companyId: string | null;
  companyName: string | null;
  action: string;
  entityType: string | null;
  entityId: string;
  reason: string | null;
  requestId: string | null;
  changes: { path: string; before: unknown; after: unknown }[];
  /** Short structured summary for legacy rows written before before/after auditing. */
  summary: string | null;
};

/** Quotes a CSV cell and neutralises spreadsheet formulas by prefixing a single quote. */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
