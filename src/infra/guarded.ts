import { AsyncLocalStorage } from 'node:async_hooks';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Store, StoreTx } from '../store/Store.ts';

type Group = Record<string, (...args: never[]) => Promise<unknown>>;
export type Queue = <T>(call: () => Promise<T>) => Promise<T>;

/** Every method of every group, called through `run`. */
function wrapped(store: StoreTx, run: Queue): StoreTx {
  const wrap = <G extends Group>(group: G): G =>
    Object.fromEntries(
      Object.entries(group).map(([name, method]) => [
        name,
        (...args: never[]) => run(() => method(...args)),
      ])
    ) as G;
  return {
    accounts: wrap(store.accounts),
    sessions: wrap(store.sessions),
    codes: wrap(store.codes),
    sync: wrap(store.sync),
    blobRecords: wrap(store.blobRecords),
    shares: wrap(store.shares),
    housekeeping: wrap(store.housekeeping),
  };
}

/**
 * Drizzle's error quotes every query parameter (Note bodies, password and token hashes); the
 * database's own error, its cause, quotes none. Never copy the cause's `detail`, which holds key
 * values.
 */
function withoutParams(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const { message, code } = (error.cause ?? {}) as { message?: string; code?: string };
  return Object.assign(new Error(`Query failed: ${message ?? 'unknown error'}`), { code });
}

/**
 * Wraps a Store so the transaction rules in Store.ts hold whatever the database: the outer Store
 * throws inside `transaction(fn)`, and the `tx` it passes throws once `fn` has ended. Every outer
 * call runs through `queue`, which the SQLite Store uses for its lock, and no error leaves it
 * quoting query values.
 */
export function guarded(inner: Store, queue: Queue = (call) => call()): Store {
  const inTransaction = new AsyncLocalStorage<{ open: boolean }>();

  const run: Queue = async (call) => {
    // Under SQLite it would wait for the lock its own transaction holds; under PostgreSQL it
    // would run outside the transaction, and could wait for a row lock the transaction holds.
    if (inTransaction.getStore()?.open) {
      throw new Error('The outer Store was called inside transaction(fn); use the tx it passes');
    }
    return queue(call).catch((error: unknown) => {
      throw withoutParams(error);
    });
  };

  /**
   * Runs `fn` as a transaction's body. `state` is cleared at the end, so work `fn` left behind
   * may use the outer Store again, and a kept `tx` cannot run outside its transaction (or, under
   * SQLite, outside the lock).
   */
  const body = <T>(fn: (state: { open: boolean }) => Promise<T>): Promise<T> => {
    const state = { open: true };
    return inTransaction
      .run(state, () => fn(state))
      .finally(() => {
        state.open = false;
      });
  };

  return {
    ...wrapped(inner, run),
    ping: () => run(() => inner.ping()),
    close: () => run(() => inner.close()),
    transaction: (fn) =>
      run(() =>
        inner.transaction((tx) =>
          body((state) =>
            fn(
              wrapped(tx, async (call) => {
                if (!state.open) throw new Error('A tx was used after its transaction ended');
                return call();
              })
            )
          )
        )
      ),
    serverBackup: {
      isEmpty: () => run(() => inner.serverBackup.isEmpty()),
      read: (fn) => run(() => inner.serverBackup.read((records) => body(() => fn(records)))),
      write: (records) => run(() => inner.serverBackup.write(records)),
    },
  };
}
