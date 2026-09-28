import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { diskBlobStore } from './blobs/disk.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/client.ts';
import { migrateDatabase } from './db/migrate.ts';
import { buildServer } from './server.ts';

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });

const db = openDatabase(join(config.dataDir, 'younotes.db'));
migrateDatabase(db);

const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
const app = await buildServer({
  config,
  db,
  blobs: await diskBlobStore(join(config.dataDir, 'blobs')),
  logger: {
    level: config.logLevel,
    ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.$client.close();
    process.exit(0);
  });
}

// `listen` logs the address it bound to.
await app.listen({ port: config.port, host: config.host });
