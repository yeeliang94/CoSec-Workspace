import { ZodError } from 'zod';
import { DomainError } from '../domain/access';
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').origin;
  if (!origin || origin !== expected)
    throw new DomainError('Request origin is unavailable. Refresh this page.', 'ORIGIN', 403);
}
export async function endpoint<T>(request: Request, fn: () => Promise<T>) {
  try {
    checkOrigin(request);
    return Response.json(await fn(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof DomainError)
      return Response.json(
        { error: error.message, code: error.code, ...(error.issues && { issues: error.issues }) },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return Response.json(
        {
          error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          code: 'VALIDATION',
        },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return Response.json(
        { error: 'Enter a valid request body.', code: 'VALIDATION' },
        { status: 400 },
      );
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure?.code === 'ER_DUP_ENTRY' || failure?.cause?.code === 'ER_DUP_ENTRY')
      return Response.json(
        { error: 'A record with this identity already exists.', code: 'DUPLICATE' },
        { status: 409 },
      );
    console.error('Request failed', {
      type: error instanceof Error ? error.name : 'Unknown',
      code: failure?.cause?.code ?? failure?.code ?? 'INTERNAL',
    });
    return Response.json(
      {
        error: 'The change could not be saved. Try again; your work has not been confirmed.',
        code: 'SERVER',
      },
      { status: 500 },
    );
  }
}
