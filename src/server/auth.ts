import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import * as schema from './schema';
import { getActorById } from './repository';
import { DomainError } from '../domain/access';
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32)
  throw new Error('Set BETTER_AUTH_SECRET to a private random value of at least 32 characters.');
export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000',
  database: drizzleAdapter(db, { provider: 'mysql', schema }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 30, cookieCache: { enabled: false } },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: { '/sign-in/email': { window: 60, max: 15 } },
  },
  advanced: { useSecureCookies: process.env.BETTER_AUTH_URL?.startsWith('https://') ?? false },
  telemetry: { enabled: false },
});
export async function requireActor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError('Sign in to continue.', 'UNAUTHENTICATED', 401);
  const actor = await getActorById(session.user.id);
  if (!actor) throw new DomainError('This account is unavailable.', 'UNAUTHENTICATED', 401);
  return actor;
}
