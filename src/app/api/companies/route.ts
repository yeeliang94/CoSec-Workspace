import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { createCompany } from '@/server/repository';
const input = z.object({
  name: z.string().trim().min(2).max(255),
  registrationNumber: z.string().trim().min(4).max(40),
  incorporationDate: z.iso.date(),
  financialYearEnd: z.iso.date(),
  address: z.string().trim().min(2).max(2000),
  activity: z.string().trim().min(2).max(500),
});
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return createCompany(actor, {
      ...input.parse(await request.json()),
      id: randomUUID(),
      createdBy: actor.id,
      legalStatus: 'Existing',
      engagementStatus: 'Active',
      verification: 'Unverified',
      sourceEvidenceId: null,
      revision: 1,
    });
  });
}
