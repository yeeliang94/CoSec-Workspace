import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { createJob } from '@/server/workflows';
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const body = await request.json();
    const requestId = z.string().min(8).max(80).parse(body.requestId);
    return createJob(actor, body, requestId);
  });
}
