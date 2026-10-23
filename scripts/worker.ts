import 'dotenv/config';
import { pruneRequestRecords, reconcileReminders } from '../src/server/support';

// Job changes keep their own company's reminders current; this sweep catches date-driven changes.
// Reconciliation is idempotent and runs per company under the company lock, so two workers are safe.
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function tick() {
  try {
    const count = await reconcileReminders();
    const pruned = await pruneRequestRecords();
    console.info(
      `${new Date().toISOString()} reconciled ${count} reminder occurrences; pruned ${pruned} request records`,
    );
  } catch (error) {
    console.error(
      'Reminder reconciliation failed; it will retry in 60 seconds.',
      error instanceof Error ? error.message : 'Unknown error',
    );
    process.exitCode = 1;
  }
  if (!stopping) timer = setTimeout(() => void tick(), 60_000);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    process.exit(0);
  });
void tick();
