// Writes docs/openapi.json from the routes' schemas. CI fails when the committed file is stale.
import { writeFileSync } from 'node:fs';
import { memoryBlobStore } from '../src/blobs/memory.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/db/client.ts';
import { migrateDatabase } from '../src/db/migrate.ts';
import { buildServer } from '../src/server.ts';

/** Sorts object keys recursively so the file only changes when the API does. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)])
    );
  }
  return value;
}

const db = openDatabase(':memory:');
migrateDatabase(db);
const app = await buildServer({
  config: loadConfig({ PUBLIC_DIR: '/nonexistent' }),
  db,
  blobs: memoryBlobStore(),
  logger: false,
});
await app.ready();
const target = new URL('../docs/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(sortKeys(app.swagger()), null, 2)}\n`);
await app.close();
console.log(`Wrote ${target.pathname}`);
