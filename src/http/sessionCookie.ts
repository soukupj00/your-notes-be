import type { FastifyReply } from 'fastify';
import { DAY_MS } from '../shared/clock.ts';

// `__Host-` stops a sibling subdomain from planting its own session; browsers then demand
// `Secure`, `Path=/` and no `Domain`, so COOKIE_OPTIONS must keep exactly that.
export const SESSION_COOKIE = '__Host-yournotes_session';

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(reply: FastifyReply, token: string, ttlDays: number): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: (ttlDays * DAY_MS) / 1000 });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}
