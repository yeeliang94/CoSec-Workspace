import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { today } from '@/domain/access';
import { capitalRegister } from '@/server/register-queries';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    capitalRegister(
      await requireActor(request),
      (await params).id,
      z.iso.date().parse(new URL(request.url).searchParams.get('asAt') ?? today()),
    ),
  );
}
