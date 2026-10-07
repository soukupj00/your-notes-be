import pino from 'pino';
import QRCode from 'qrcode';
import { type Config, loadConfig, REDACT } from './config.ts';
import { pairingLink } from './contract/index.ts';
import { openBlobStore, openStore } from './infra/open.ts';
import { SWEEP_EVERY_MS } from './modules/housekeeping/service.ts';
import { buildServer } from './server.ts';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  // Before the logger, whose level the config sets.
  console.error((error as Error).message);
  process.exit(1);
}

const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
// Made before the server, so waiting for the database logs the same way as everything after.
const log = pino({
  level: config.logLevel,
  redact: REDACT,
  ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
});
const fail = (error: Error): never => {
  log.fatal(error.message);
  process.exit(1);
};

const store = await openStore(config, {
  warn: (message) => log.warn(message),
  // A second instance would split Live Updates, rate limits and the sweep (ADR 0006).
  oneInstance: { onLost: fail },
}).catch(fail);
const blobs = await openBlobStore(config, (message) => log.warn(message)).catch(fail);

const app = await buildServer({ config, store, blobs, logger: log });
// A failed sweep, say S3 briefly unreachable, waits for the next one rather than stopping us.
const sweep = () =>
  app.services.housekeeping
    .sweep(new Date())
    .catch((error) => app.log.error({ err: error }, 'sweep failed'));
await sweep();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await store.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });

setInterval(sweep, SWEEP_EVERY_MS).unref();

// First run (ADR 0001): a new link on every start until the Owner exists.
const setupCode = await app.services.pairing.ensureSetupCode();
if (setupCode) {
  const url = pairingLink(config.publicUrl, setupCode);
  app.log.info({ pairingLink: url }, 'No Owner yet: open the Pairing Link to create one');
  // Also plain stdout, so it reads well in `docker compose logs` whatever the logger does.
  console.log(`\nNo Owner yet. Open this link on the Device you want to use:\n\n  ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
}
