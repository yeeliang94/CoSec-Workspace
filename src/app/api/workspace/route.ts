import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { listCompanies, listUsers } from '@/server/repository';
import { getWorkspaceSupport } from '@/server/support';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const [companies, users, support] = await Promise.all([
      listCompanies(actor),
      listUsers(actor),
      getWorkspaceSupport(actor),
    ]);
    return { actor, companies, users, ...support };
  });
}
