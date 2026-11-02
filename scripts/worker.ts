import 'dotenv/config';
import { pruneRequestRecords } from '../src/server/support';
import { reconcilePendingGenerations } from '../src/server/resolution/generation';

// Housekeeping sweep. Each step is idempotent, so two workers are safe.
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function tick() {
  try {
    const pruned = await pruneRequestRecords();
    // Generations left Pending by an interrupted render become Failed; orphan files are removed.
    const generations = await reconcilePendingGenerations();
    if (generations.failed > 0)
      console.warn(
        `${new Date().toISOString()} ${generations.failed} interrupted document generation(s) marked failed. Generate the affected documents again.`,
      );
    // Routine sweeps run every minute; show their summaries only when troubleshooting.
    if (process.env.COSEC_WORKER_VERBOSE === '1')
      console.info(
        `${new Date().toISOString()} pruned ${pruned} request records; generation reconciliation ${JSON.stringify(generations)}`,
      );
  } catch (error) {
    console.error(
      'Worker sweep failed; it will retry in 60 seconds.',
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
