import type { Officer, OfficerEvent } from './model';
/** Date-effective history: entries retain recorded time but never rewrite earlier snapshots. */
export function officersAt(events: OfficerEvent[], asAt: string): Officer[] {
  const people = new Map<string, Officer>();
  for (const event of [...events]
    .filter((e) => e.effectiveDate <= asAt)
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.id.localeCompare(b.id),
    )) {
    if (event.route === 'appointment')
      people.set(event.personId, {
        personId: event.personId,
        personName: event.personName,
        appointedOn: event.effectiveDate,
        eventId: event.id,
      });
    else people.delete(event.personId);
  }
  return [...people.values()].sort((a, b) => a.personName.localeCompare(b.personName));
}
