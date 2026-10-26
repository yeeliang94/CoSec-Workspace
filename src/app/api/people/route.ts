import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { changePerson, listPeople } from '@/server/records/people';
import { personInput, recordId, searchParams } from '@/server/records/inputs';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const query = z
      .object({ q: z.string().max(200).optional(), companyId: recordId.optional() })
      .parse(searchParams(request));
    return listPeople(actor, query);
  });
}

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return changePerson(actor, personInput.parse(await request.json()));
  });
}
