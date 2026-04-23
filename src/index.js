require('dotenv').config();

const CDCPoller = require('./cdcPoller');
const storage   = require('./storageWriter');
const logger    = require('./logger');
const sources   = require('../config/sources');

// Validate required env vars
const REQUIRED = [
  'STORAGE_HOST', 'STORAGE_PORT',
  'STORAGE_DB',   'STORAGE_USER', 'STORAGE_PASS',
];

function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    logger.error('Missing required env vars', { missing });
    process.exit(1);
  }
}

async function main() {
  logger.info('=================================');
  logger.info('   CDC Service Starting...       ');
  logger.info('=================================');

  validateEnv();

  // Filter enabled sources only
  const activeSources = sources.filter(s => s.enabled);

  if (activeSources.length === 0) {
    logger.error('No active source DBs configured');
    process.exit(1);
  }

  logger.info(`Starting ${activeSources.length} poller(s)`, {
    sources: activeSources.map(s => s.id),
  });

  // Start one poller per source DB
  const pollers = activeSources.map(config => new CDCPoller(config));

  // Start all pollers in parallel
  await Promise.allSettled(
    pollers.map(async (poller) => {
      try {
        await poller.start();
      } catch (err) {
        logger.error(`Failed to start poller`, {
          id    : poller.id,
          error : err.message,
        });
      }
    })
  );

  // Graceful shutdown
  async function shutdown(signal) {
    logger.info(`Signal: ${signal} — shutting down...`);
    await Promise.allSettled(pollers.map(p => p.stop()));
    await storage.closePool();
    logger.info('All pollers stopped. Goodbye.');
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception', { error: err.message });
    await shutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    await shutdown('unhandledRejection');
  });
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});