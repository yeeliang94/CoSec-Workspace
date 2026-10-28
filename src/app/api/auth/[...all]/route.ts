import { auth } from '@/server/auth';
import { exclusive } from '@/server/db';
import { toNextJsHandler } from 'better-auth/next-js';
const handler = toNextJsHandler(auth);
export const GET = (request: Request) => exclusive(() => handler.GET(request));
export const POST = (request: Request) => exclusive(() => handler.POST(request));
