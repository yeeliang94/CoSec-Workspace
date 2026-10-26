import { bindingInfo, resolveBinding } from './bindings';
import type {
  AnswerValue,
  Answers,
  FieldDefinition,
  PersonSnapshot,
  RecordContext,
  RecordProperty,
  ResolutionContext,
} from './model';
import { DECIMAL } from './schema';

// ---------------------------------------------------------------- exact decimals
/** Splits an exact decimal string into a scaled integer. Never uses floating point. */
export function parseDecimal(value: string): { units: bigint; scale: number } {
  if (!DECIMAL.test(value)) throw new Error(`Not an exact decimal: ${value}`);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}
function rescale(units: bigint, from: number, to: number) {
  return units * 10n ** BigInt(to - from);
}
function toText(units: bigint, scale: number) {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return negative ? `-${text}` : text;
}
export function addDecimals(values: string[]) {
  const parsed = values.map(parseDecimal);
  const scale = Math.max(0, ...parsed.map((p) => p.scale));
  const total = parsed.reduce((sum, p) => sum + rescale(p.units, p.scale, scale), 0n);
  return toText(total, scale);
}
export function compareDecimals(a: string, b: string) {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const scale = Math.max(x.scale, y.scale);
  const left = rescale(x.units, x.scale, scale);
  const right = rescale(y.units, y.scale, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}
/** Fixed places (half away from zero) with optional thousands separators. */
export function formatDecimal(value: string, decimals?: number, group = false) {
  let { units, scale } = parseDecimal(value);
  if (decimals !== undefined && decimals !== scale) {
    if (decimals > scale) units = rescale(units, scale, decimals);
    else {
      const divisor = 10n ** BigInt(scale - decimals);
      const negative = units < 0n;
      const magnitude = negative ? -units : units;
      let rounded = magnitude / divisor;
      if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;
      units = negative ? -rounded : rounded;
    }
    scale = decimals;
  }
  const text = toText(units, scale);
  if (!group) return text;
  const [whole, fraction] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

// ---------------------------------------------------------------- dates
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
/** Calendar-day arithmetic on date-only values (UTC, so no daylight-saving drift). */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function formatLongDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- value resolution
export type RowValues = Record<string, AnswerValue>;
export type Raw =
  string | boolean | string[] | PersonSnapshot | PersonSnapshot[] | RowValues | null;
export type Resolved = { value: Raw; sample: boolean };
/** A template unit: the assembly (key ASSEMBLY_KEY) or one clause entry of the case. */
export type Unit = { key: string; name: string; fields: FieldDefinition[] };
export const ASSEMBLY_KEY = '@assembly';
export type CaseAnswers = { shared: Answers; clauses: Record<string, Answers> };

export function poolFor(ctx: ResolutionContext, context: RecordContext | undefined) {
  switch (context) {
    case 'currentDirectors':
      return ctx.directors;
    case 'currentMembers':
      return ctx.members;
    case 'companyPeople':
      return ctx.companyPeople;
    case 'proposedPerson':
      return ctx.proposedPeople;
    default:
      return [];
  }
}
export function isEmptyValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
export function isPerson(value: unknown): value is PersonSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'name' in value;
}

/**
 * Resolves field values for one case. Case-scope fields share one namespace (assembly
 * definitions first, then first-seen clause definitions); clause-scope fields live under their
 * clause entry key. Assembly fields are always case scope.
 */
export class ValueResolver {
  private memo = new Map<string, Resolved>();
  private active = new Set<string>();
  readonly shared = new Map<string, FieldDefinition>();
  private units = new Map<string, Unit>();
  constructor(
    readonly ctx: ResolutionContext,
    units: Unit[],
    readonly answers: CaseAnswers,
  ) {
    for (const unit of units) {
      this.units.set(unit.key, unit);
      for (const field of unit.fields)
        if ((field.scope === 'case' || unit.key === ASSEMBLY_KEY) && !this.shared.has(field.id))
          this.shared.set(field.id, field);
    }
  }
  /** The governing definition and namespace for a field id used inside a unit. */
  lookup(unitKey: string, fieldId: string): { def: FieldDefinition; ns: string } | null {
    const local = this.units.get(unitKey)?.fields.find((f) => f.id === fieldId);
    if (local && local.scope === 'clause' && unitKey !== ASSEMBLY_KEY)
      return { def: local, ns: unitKey };
    const shared = this.shared.get(fieldId);
    return shared ? { def: shared, ns: 'case' } : null;
  }
  answer(ns: string, fieldId: string): AnswerValue | Record<string, AnswerValue> | undefined {
    const bag = ns === 'case' ? this.answers.shared : this.answers.clauses[ns];
    return bag && Object.hasOwn(bag, fieldId) ? bag[fieldId] : undefined;
  }
  get(unitKey: string, fieldId: string): Resolved {
    const found = this.lookup(unitKey, fieldId);
    if (!found) return { value: null, sample: false };
    const id = `${found.ns}:${fieldId}`;
    const cached = this.memo.get(id);
    if (cached) return cached;
    if (this.active.has(id)) return { value: null, sample: false }; // cycles are rejected earlier
    this.active.add(id);
    // A shared field has one value per case, so its inputs come from the shared scope rather
    // than from whichever clause asked first.
    const resolved = this.compute(
      found.ns === 'case' ? ASSEMBLY_KEY : unitKey,
      found.def,
      found.ns,
    );
    this.active.delete(id);
    this.memo.set(id, resolved);
    return resolved;
  }
  people(unitKey: string, fieldId: string): PersonSnapshot[] {
    const value = this.get(unitKey, fieldId).value;
    return Array.isArray(value) && value.every(isPerson) ? (value as PersonSnapshot[]) : [];
  }
  private compute(unitKey: string, def: FieldDefinition, ns: string): Resolved {
    const source = def.source;
    if (source.kind === 'binding') {
      if (!bindingInfo(source.path)) return { value: null, sample: false };
      const value = resolveBinding(source.path, this.ctx, (id) => {
        const v = this.get(unitKey, id).value;
        return isPerson(v) ? v : null;
      });
      return { value: typeof value === 'boolean' ? value : (value ?? null), sample: false };
    }
    if (source.kind === 'constant') {
      if (def.valueType === 'boolean') return { value: source.value === 'true', sample: false };
      return { value: source.value, sample: false };
    }
    if (source.kind === 'question') {
      const given = this.answer(ns, def.id);
      const raw = given === undefined ? (def.defaultValue ?? null) : given;
      if (def.repeatScope)
        return {
          value: raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as RowValues) : {},
          sample: false,
        };
      if (def.valueType === 'recordReference') {
        const pool = poolFor(this.ctx, def.record?.context);
        return { value: pool.find((p) => p.id === raw) ?? null, sample: false };
      }
      if (def.valueType === 'recordList') {
        const pool = poolFor(this.ctx, def.record?.context);
        const ids = Array.isArray(raw) ? raw : [];
        return {
          value: ids.map((id) => pool.find((p) => p.id === id)).filter((p) => p !== undefined),
          sample: false,
        };
      }
      return { value: raw as Raw, sample: false };
    }
    // derived
    const base = this.get(unitKey, source.fieldId);
    if (source.op === 'addDays') {
      const date = base.value;
      return {
        value: isDate(date) ? addDays(date, source.days) : null,
        sample: base.sample || !source.sourceNote.trim(),
      };
    }
    if (source.op === 'count') {
      const list = base.value;
      return { value: Array.isArray(list) ? String(list.length) : '0', sample: base.sample };
    }
    if (source.op === 'join') {
      const list = this.people(unitKey, source.fieldId);
      const parts = list
        .map((p) => personProperty(p, source.property))
        .filter((v): v is string => !!v);
      return { value: parts.length ? joinNames(parts) : null, sample: base.sample };
    }
    // sum over a per-row number field, for the items currently in its list
    const found = this.lookup(unitKey, source.fieldId);
    const listId = found?.def.repeatScope;
    if (!listId) return { value: null, sample: false };
    const rows = base.value && typeof base.value === 'object' ? (base.value as RowValues) : {};
    const values = this.people(unitKey, listId)
      .map((item) => rows[item.id])
      .filter((v): v is string => typeof v === 'string' && DECIMAL.test(v));
    return { value: values.length ? addDecimals(values) : null, sample: base.sample };
  }
}

export function joinNames(parts: string[]) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
export function personProperty(person: PersonSnapshot, property: RecordProperty) {
  const value = person[property];
  if (value && (property === 'appointedOn' || property === 'ceasedOn') && isDate(value))
    return formatLongDate(value);
  return value ?? '';
}

/** Display text for a scalar value; '' when empty. */
export function formatValue(def: FieldDefinition, value: Raw | AnswerValue | undefined): string {
  const apply = (text: string) => {
    if (!text) return text;
    const prefixed = def.format?.prefix ? `${def.format.prefix}${text}` : text;
    return def.format?.case === 'upper' ? prefixed.toUpperCase() : prefixed;
  };
  if (value === null || value === undefined) return '';
  if (isPerson(value)) return apply(value.name);
  if (Array.isArray(value)) {
    if (value.every(isPerson))
      return apply(joinNames((value as PersonSnapshot[]).map((p) => p.name)));
    const labels = (value as string[]).map(
      (id) => def.options?.find((o) => o.id === id)?.label ?? id,
    );
    return apply(joinNames(labels));
  }
  if (typeof value === 'boolean') return apply(value ? 'Yes' : 'No');
  if (typeof value === 'object') return '';
  const text = String(value);
  switch (def.valueType) {
    case 'date':
      return apply(isDate(text) && def.format?.date !== 'iso' ? formatLongDate(text) : text);
    case 'number':
      return apply(
        DECIMAL.test(text)
          ? formatDecimal(text, def.format?.decimals, def.format?.decimals !== undefined)
          : text,
      );
    case 'choice':
      return apply(def.options?.find((o) => o.id === text)?.label ?? text);
    default:
      return apply(text);
  }
}
