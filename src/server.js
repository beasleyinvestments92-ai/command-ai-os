import { createApp } from './app.js';
import { config, validateConfig } from './config.js';
import { closePool } from './db/index.js';
import { migrate } from '../scripts/migrate.js';
import { seed } from '../scripts/seed.js';

validateConfig();
if (process.env.AUTO_MIGRATE !== 'false') await migrate();
if (process.env.AUTO_SEED === 'true') await seed();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`COMMAND AI OS ${config.nodeEnv} server listening on ${config.appUrl}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
