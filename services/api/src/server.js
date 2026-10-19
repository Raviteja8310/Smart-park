import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';

const server = app.listen(env.API_PORT, () => {
  console.log(`SmartPark API listening at http://localhost:${env.API_PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down SmartPark API...`);
  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('Error while closing database pool:', error.message);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
