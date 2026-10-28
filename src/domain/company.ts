/**
 * A financial year end is a day and month ("12-31"), not a dated deadline, so it applies every
 * year. Older records stored a full date; only its month and day are used.
 */
export const MONTHS = [
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
] as const;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function yearEndMonthDay(value: string): string {
  return value.slice(-5);
}

export function isYearEnd(value: string): boolean {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/** "31 December". */
export function formatYearEnd(value: string | null | undefined): string {
  if (!value) return '—';
  const monthDay = yearEndMonthDay(value);
  if (!isYearEnd(monthDay)) return value;
  return `${Number(monthDay.slice(3))} ${MONTHS[Number(monthDay.slice(0, 2)) - 1]}`;
}

/** The first year end on or after `asAt` (YYYY-MM-DD); 29 February falls back to the 28th. */
export function nextYearEnd(value: string, asAt: string): string {
  const monthDay = yearEndMonthDay(value);
  const inYear = (year: number) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-${monthDay === '02-29' && !leap ? '02-28' : monthDay}`;
  };
  const year = Number(asAt.slice(0, 4));
  const candidate = inYear(year);
  return candidate >= asAt ? candidate : inYear(year + 1);
}

/** MSIC 2008 sections, the top level of Malaysia's standard industrial classification. */
export const INDUSTRIES = [
  ['A', 'Agriculture, forestry and fishing'],
  ['B', 'Mining and quarrying'],
  ['C', 'Manufacturing'],
  ['D', 'Electricity, gas, steam and air conditioning supply'],
  ['E', 'Water supply; sewerage, waste management and remediation'],
  ['F', 'Construction'],
  ['G', 'Wholesale and retail trade; repair of motor vehicles and motorcycles'],
  ['H', 'Transportation and storage'],
  ['I', 'Accommodation and food service'],
  ['J', 'Information and communication'],
  ['K', 'Financial and insurance/takaful'],
  ['L', 'Real estate'],
  ['M', 'Professional, scientific and technical'],
  ['N', 'Administrative and support services'],
  ['O', 'Public administration and defence; compulsory social security'],
  ['P', 'Education'],
  ['Q', 'Human health and social work'],
  ['R', 'Arts, entertainment and recreation'],
  ['S', 'Other service activities'],
  ['T', 'Activities of households as employers'],
  ['U', 'Extraterritorial organisations and bodies'],
] as const;
export type IndustryCode = (typeof INDUSTRIES)[number][0];

export function industryLabel(code: string | null | undefined): string {
  return INDUSTRIES.find(([value]) => value === code)?.[1] ?? '—';
}
