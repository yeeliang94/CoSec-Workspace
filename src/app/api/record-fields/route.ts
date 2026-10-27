import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { changeFieldDefinition, listFieldDefinitions } from '@/server/records/custom-fields';
import { fieldDefinitionInput, searchParams } from '@/server/records/inputs';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    await requireActor(request);
    const query = z
      .object({
        scope: z.enum(['company', 'person', 'case']).optional(),
        includeArchived: z.enum(['true', 'false']).optional(),
      })
      .parse(searchParams(request));
    return {
      definitions: await listFieldDefinitions({
        scope: query.scope,
        includeArchived: query.includeArchived === 'true',
      }),
    };
  });
}

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return changeFieldDefinition(actor, fieldDefinitionInput.parse(await request.json()));
  });
}
