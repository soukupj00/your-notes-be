import type { Db } from '../../db/client.ts';

export class MetaService {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** A database round trip, so `/health` fails when the database does. */
  ping(): void {
    this.#db.$client.prepare('select 1').get();
  }
}
