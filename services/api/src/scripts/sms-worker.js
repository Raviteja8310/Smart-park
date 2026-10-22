import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { sendSms } from '../services/sms-delivery.js';
import { processOneSms } from '../services/sms-outbox-worker.js';
const POLL_MS = 2500;
const workerId = `sms-${process.pid}-${randomUUID()}`;
let stopping = false;
export async function runSmsWorker({ once = false, executorPool = pool, sender = sendSms, logger = console } = {}) {
  if (env.SMS_PROVIDER !== 'twilio') {
    logger.warn?.('SMS_PROVIDER is not twilio; SMS delivery is disabled. Configure the provider before starting the SMS worker.');
    return { disabled: true, processed: false };
  }
  do {
    try {
      const result = await processOneSms(executorPool,sender,logger,workerId);
      if (once && !result.processed) return;
      if (!result.processed) await delay(POLL_MS);
    } catch (error) {
      logger.error?.('SmartPark SMS worker loop error:',error?.code ?? error?.message ?? 'unknown error');
      if (once) throw error;
      await delay(5000);
    }
  } while (!stopping);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (env.SMS_PROVIDER !== 'twilio') console.warn('SMS_PROVIDER is not twilio; queued SMS will not be sent until the provider is configured.');
  const once = process.argv.includes('--once');
  process.on('SIGTERM',()=>{stopping=true;}); process.on('SIGINT',()=>{stopping=true;});
  runSmsWorker({once}).then(async()=>{await pool.end();process.exitCode=0;}).catch(async(error)=>{console.error('SmartPark SMS worker stopped:',error?.code ?? error?.message ?? 'unknown error');await pool.end().catch(()=>{});process.exitCode=1;});
}
