import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { createCase, listCases } from '@/server/records/cases';
import { createCaseInput, recordId, searchParams } from '@/server/records/inputs';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const { companyId } = z.object({ companyId: recordId.optional() }).parse(searchParams(request));
    return { cases: await listCases(actor, companyId) };
  });
}

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return createCase(actor, createCaseInput.parse(await request.json()));
  });
}
