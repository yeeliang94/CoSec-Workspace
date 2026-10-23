import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { readUsers, changeUser } from '@/server/users';
export async function GET(request: Request) {
  return endpoint(request, async () => readUsers(await requireActor(request)));
}
export async function POST(request: Request) {
  return endpoint(request, async () =>
    changeUser(await requireActor(request), await request.json()),
  );
}
