import type { Store } from '../../store/Store.ts';
import { guarded } from '../guarded.ts';

/**
 * Runs every call of `inner` through one async lock, so a transaction held across awaits never
 * shares the one connection with another request (ADR 0006).
 */
export function locked(inner: Store): Store {
  let last: Promise<unknown> = Promise.resolve();
  return guarded(inner, (call) => {
    const result = last.then(call);
    last = result.catch(() => undefined);
    return result;
  });
}
