import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(request, () => requireActor(request));
}
