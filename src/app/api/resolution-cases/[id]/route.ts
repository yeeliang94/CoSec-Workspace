import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { changeCase, getCaseDetail } from '@/server/records/cases';
import { caseActionInput, recordId } from '@/server/records/inputs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return getCaseDetail(actor, recordId.parse((await params).id));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const body = caseActionInput.parse(await request.json());
    return changeCase(actor, recordId.parse((await params).id), body);
  });
}
