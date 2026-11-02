import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jobs = vi.hoisted(() => ({
  reminders: vi.fn(),
  prune: vi.fn(),
  generations: vi.fn(),
}));
vi.mock('../src/server/support', () => ({
  reconcileReminders: jobs.reminders,
  pruneRequestRecords: jobs.prune,
}));
vi.mock('../src/server/resolution/generation', () => ({
  reconcilePendingGenerations: jobs.generations,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('COSEC_WORKER_VERBOSE', '');
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  jobs.reminders.mockReset().mockResolvedValue(7);
  jobs.prune.mockReset().mockResolvedValue(0);
  jobs.generations.mockReset().mockResolvedValue({ failed: 0, removedFiles: 0 });
});
afterEach(() => {
  process.exitCode = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function startWorker() {
  await import('../scripts/worker');
  await vi.advanceTimersByTimeAsync(0);
}

describe('background worker logging', () => {
  it('keeps successful recurring checks quiet while continuing maintenance', async () => {
    await startWorker();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobs.reminders).toHaveBeenCalledTimes(2);
    expect(jobs.prune).toHaveBeenCalledTimes(2);
    expect(jobs.generations).toHaveBeenCalledTimes(2);
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('allows diagnostic summaries to be enabled explicitly', async () => {
    vi.stubEnv('COSEC_WORKER_VERBOSE', '1');
    await startWorker();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('reconciled 7'));
  });

  it('reports interrupted generations that were marked failed', async () => {
    jobs.generations.mockResolvedValue({ failed: 1, removedFiles: 0 });
    await startWorker();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('1 interrupted document generation'),
    );
  });

  it('keeps real errors visible and retries after 60 seconds', async () => {
    jobs.reminders.mockRejectedValueOnce(new Error('Database unavailable'));
    await startWorker();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('retry in 60 seconds'),
      'Database unavailable',
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobs.reminders).toHaveBeenCalledTimes(2);
    expect(jobs.generations).toHaveBeenCalledTimes(1);
  });
});
