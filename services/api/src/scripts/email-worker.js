import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { sendTransactionalEmail } from '../services/transactional-mailer.js';
import { processOneEmail } from '../services/email-outbox-worker.js';

const POLL_MS = 2000;
const workerId = `email-${process.pid}-${randomUUID()}`;
let stopping = false;

export async function runEmailWorker({ once = false, executorPool = pool, sender = sendTransactionalEmail, logger = console } = {}) {
  do {
    try {
      const result = await processOneEmail(executorPool, sender, logger, workerId);
      if (once && !result.processed) return;
      if (!result.processed) await delay(POLL_MS);
    } catch (error) {
      logger.error?.('SmartPark email worker loop error:', error?.code ?? error?.message ?? 'unknown error');
      if (once) throw error;
      await delay(5000);
    }
  } while (!stopping);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const once = process.argv.includes('--once');
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  runEmailWorker({ once }).then(async () => {
    await pool.end();
    process.exitCode = 0;
  }).catch(async (error) => {
    console.error('SmartPark email worker stopped:', error?.message ?? error);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
