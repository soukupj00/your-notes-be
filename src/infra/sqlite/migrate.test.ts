import { expect, it } from 'vitest';
import { openDatabase } from './client.ts';
import { migrateDatabase } from './migrate.ts';

it('applies every migration to an empty database, twice without harm', () => {
  const db = openDatabase(':memory:');
  migrateDatabase(db);
  migrateDatabase(db);

  const tables = db.$client
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all();
  expect(tables).toMatchInlineSnapshot(`
    [
      {
        "name": "__drizzle_migrations",
      },
      {
        "name": "accounts",
      },
      {
        "name": "blobs",
      },
      {
        "name": "codes",
      },
      {
        "name": "note_tags",
      },
      {
        "name": "notes",
      },
      {
        "name": "sessions",
      },
      {
        "name": "shares",
      },
      {
        "name": "tags",
      },
      {
        "name": "tombstones",
      },
    ]
  `);
  expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
});
