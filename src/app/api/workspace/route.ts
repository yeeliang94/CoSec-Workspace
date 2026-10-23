import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { listCompanies, listJobs, listUsers } from '@/server/repository';
import { getWorkspaceSupport } from '@/server/support';
import { blockers, nextAction } from '@/domain/workflows';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const [companies, jobs, users, support] = await Promise.all([
      listCompanies(actor),
      listJobs(actor),
      listUsers(),
      getWorkspaceSupport(actor),
    ]);
    return {
      actor,
      companies,
      jobs: jobs.map((job) => ({ ...job, blockers: blockers(job), nextAction: nextAction(job) })),
      users,
      ...support,
    };
  });
}
