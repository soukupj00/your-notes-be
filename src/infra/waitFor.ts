import { setTimeout } from 'node:timers/promises';
import type { Warn } from '../shared/warn.ts';

/** How long startup waits for a backend Compose starts beside the server (setup-backends.md). */
const WAIT_S = 30;
/**
 * One try's limit, so a host that never answers is tried again within the wait. Above the 5 s a
 * resolver such as Docker's takes to give up on an unknown name, so that try still ends in
 * "cannot resolve host" rather than a timeout.
 */
const TRY_MS = 6000;
const PAUSE_MS = 1000;

/** Retries only the failures `judge` says a retry may fix, warning of each; others fail at once. */
export async function waitFor<T>(
  what: string,
  attempt: (timeoutMs: number) => Promise<T>,
  judge: (error: unknown) => { reason: string; retry: boolean },
  warn: Warn
): Promise<T> {
  const deadline = Date.now() + WAIT_S * 1000;
  for (;;) {
    try {
      return await attempt(Math.max(1, Math.min(TRY_MS, deadline - Date.now())));
    } catch (error) {
      const { reason, retry } = judge(error);
      if (!retry) throw new Error(`Cannot use ${what}: ${reason}`);
      if (Date.now() + PAUSE_MS >= deadline) {
        throw new Error(`${what} was not ready after ${WAIT_S} s: ${reason}`);
      }
      warn(`Waiting for ${what}: ${reason}`);
      await setTimeout(PAUSE_MS);
    }
  }
}

/** A host that cannot be reached, in plain words; undefined for any other error. */
export function unreachable(error: unknown): string | undefined {
  const { code, hostname } = error as { code?: string; hostname?: string };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `cannot resolve host ${hostname}`;
  if (code === 'ECONNREFUSED') return 'connection refused';
  return undefined;
}
