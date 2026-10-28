import { nextYearEnd } from '../company';
import type { PersonSnapshot, RecordProperty, ResolutionContext } from './model';

export type BindingType = 'text' | 'date' | 'any';
export type BindingInfo = { path: string; valueType: BindingType; description: string };

/** The complete allowlist. Anything not listed (or matching a pattern below) is rejected. */
export const BINDINGS: readonly BindingInfo[] = [
  { path: 'company.name', valueType: 'text', description: 'Company name' },
  { path: 'company.registrationNumber', valueType: 'text', description: 'Registration number' },
  { path: 'company.address', valueType: 'text', description: 'Registered address' },
  { path: 'company.incorporationDate', valueType: 'date', description: 'Incorporation date' },
  { path: 'company.financialYearEnd', valueType: 'date', description: 'Financial year end' },
  {
    path: 'company.citation.directorAuthority',
    valueType: 'text',
    description: "Constitution citation: directors' authority",
  },
  {
    path: 'company.citation.memberAuthority',
    valueType: 'text',
    description: "Constitution citation: members' authority",
  },
  {
    path: 'company.citation.electionAuthority',
    valueType: 'text',
    description: 'Constitution citation: election authority',
  },
  { path: 'case.title', valueType: 'text', description: 'Case title' },
  { path: 'case.instructionDate', valueType: 'date', description: 'Case instruction date' },
  { path: 'case.resolutionDate', valueType: 'date', description: 'Case resolution date' },
  { path: 'case.effectiveDate', valueType: 'date', description: 'Case effective date' },
  { path: 'job.personName', valueType: 'text', description: 'Director change: person' },
  { path: 'job.effectiveDate', valueType: 'date', description: 'Director change: effective date' },
  { path: 'job.route', valueType: 'text', description: 'Director change: route' },
  { path: 'firm.name', valueType: 'text', description: 'Firm name' },
  { path: 'today', valueType: 'date', description: 'Date of preparation' },
];
const CUSTOM = /^(company|case)\.custom\.([a-zA-Z0-9_-]{1,64})$/;
const SELECTION = /^selection\.([a-z][a-z0-9_]{1,63})\.(name|capacity|appointedOn|ceasedOn)$/;

/** Registry entry for a path, or null when the path is not allowed. */
export function bindingInfo(path: string): (BindingInfo & { selection?: string }) | null {
  const fixed = BINDINGS.find((b) => b.path === path);
  if (fixed) return fixed;
  const custom = CUSTOM.exec(path);
  if (custom)
    return {
      path,
      valueType: 'any',
      description: `${custom[1] === 'company' ? 'Company' : 'Case'} custom field`,
    };
  const selection = SELECTION.exec(path);
  if (selection)
    return {
      path,
      valueType: selection[2] === 'appointedOn' || selection[2] === 'ceasedOn' ? 'date' : 'text',
      description: `Selected person: ${selection[2]}`,
      selection: selection[1],
    };
  return null;
}

export type BoundValue = string | boolean | null;

/**
 * Resolves an allowlisted path against the authorised context. `selected` resolves a
 * recordReference question (for `selection.<fieldId>.<property>`).
 */
export function resolveBinding(
  path: string,
  ctx: ResolutionContext,
  selected: (fieldId: string) => PersonSnapshot | null,
): BoundValue {
  const info = bindingInfo(path);
  if (!info) throw new Error(`Binding ${path} is not allowed.`);
  const custom = CUSTOM.exec(path);
  if (custom) {
    const bag = custom[1] === 'company' ? ctx.company.custom : ctx.case.custom;
    return Object.hasOwn(bag, custom[2]) ? (bag[custom[2]] ?? null) : null;
  }
  const selection = SELECTION.exec(path);
  if (selection) {
    const person = selected(selection[1]);
    return person ? (person[selection[2] as RecordProperty] ?? null) : null;
  }
  switch (path) {
    case 'company.name':
      return ctx.company.name;
    case 'company.registrationNumber':
      return ctx.company.registrationNumber;
    case 'company.address':
      return ctx.company.address;
    case 'company.incorporationDate':
      return ctx.company.incorporationDate;
    case 'company.financialYearEnd':
      // The year end that closes the financial year in progress on the record date.
      return ctx.company.financialYearEnd
        ? nextYearEnd(ctx.company.financialYearEnd, ctx.asAt)
        : null;
    case 'company.citation.directorAuthority':
      return ctx.company.citations.directorAuthority ?? null;
    case 'company.citation.memberAuthority':
      return ctx.company.citations.memberAuthority ?? null;
    case 'company.citation.electionAuthority':
      return ctx.company.citations.electionAuthority ?? null;
    case 'case.title':
      return ctx.case.title;
    case 'case.instructionDate':
      return ctx.case.instructionDate;
    case 'case.resolutionDate':
      return ctx.case.resolutionDate;
    case 'case.effectiveDate':
      return ctx.case.effectiveDate;
    case 'job.personName':
      return ctx.job?.personName ?? null;
    case 'job.effectiveDate':
      return ctx.job?.effectiveDate ?? null;
    case 'job.route':
      return ctx.job?.route ?? null;
    case 'firm.name':
      return ctx.firm.name;
    case 'today':
      return ctx.preparedOn;
  }
  throw new Error(`Binding ${path} is not allowed.`);
}

/** Human source label shown beside a read-only bound value in the form. */
export function bindingSourceLabel(path: string, asAt: string) {
  const info = bindingInfo(path);
  if (!info) return 'Unavailable source';
  if (path.startsWith('selection.')) return `${info.description} (from your selection)`;
  if (path === 'today') return 'Date of preparation';
  return `${path.startsWith('company.') ? 'Company record' : path.startsWith('case.') ? 'Resolution case' : path.startsWith('job.') ? 'Linked director change' : 'Firm settings'}: ${info.description} (as at ${asAt})`;
}
