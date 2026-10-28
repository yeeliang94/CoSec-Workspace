import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { createCompany } from '@/server/repository';
import { INDUSTRIES, isYearEnd, yearEndMonthDay } from '@/domain/company';
const input = z.object({
  name: z.string().trim().min(2).max(255),
  registrationNumber: z.string().trim().min(4).max(40),
  incorporationDate: z.iso.date(),
  financialYearEnd: z
    .string()
    .transform(yearEndMonthDay)
    .refine(isYearEnd, 'Choose the day and month of the financial year end.'),
  address: z.string().trim().min(2).max(2000),
  industry: z.enum(INDUSTRIES.map(([code]) => code)),
  activity: z.string().trim().max(500).default(''),
  people: z
    .array(
      z.object({
        personId: z.string().min(1).max(64).optional(),
        fullName: z.string().trim().min(1).max(255).optional(),
        role: z.enum(['director', 'member', 'secretary', 'auditor', 'other']),
        startDate: z.iso.date().nullable().default(null),
      }),
    )
    .max(50)
    .default([])
    .refine(
      (people) => people.every((p) => p.personId || p.fullName),
      'Enter a name for each person.',
    ),
});
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const { people, ...company } = input.parse(await request.json());
    return createCompany(actor, people, {
      ...company,
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
