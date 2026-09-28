import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { ensureSetupCode } from './auth/codes.ts';
import { diskBlobStore } from './blobs/disk.ts';
import { loadConfig } from './config.ts';
import { pairingLink } from './contract/index.ts';
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

// First run (ADR 0001): a new link on every start until the Owner exists.
const setupCode = ensureSetupCode(db, new Date());
if (setupCode) {
  const url = pairingLink(config.publicUrl, setupCode);
  app.log.info({ pairingLink: url }, 'No Owner yet: open the Pairing Link to create one');
  // Also plain stdout, so it reads well in `docker compose logs` whatever the logger does.
  console.log(`\nNo Owner yet. Open this link on the Device you want to use:\n\n  ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
}
