import type { FastifyReply } from 'fastify';
import { DAY_MS } from '../shared/clock.ts';

export const SESSION_COOKIE = 'younotes_session';

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(reply: FastifyReply, token: string, ttlDays: number): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: (ttlDays * DAY_MS) / 1000 });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}
