import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';
import { startVisionStaleMonitor } from './vision/stale-monitor.js';

// On Vercel (VERCEL=1) the platform runs the exported Express app as a serverless function and
// manages its lifecycle: no listener, no background timer, no signal handlers. The stale-camera
// check runs from Vercel Cron instead (GET /api/internal/cron/vision-stale, see internal.routes.js).
// Everywhere else (npm run dev, npm start, Docker) the API keeps running as a persistent server.
if (!process.env.VERCEL) {
  const stopVisionStaleMonitor = startVisionStaleMonitor(pool);

  const server = app.listen(env.API_PORT, () => {
    console.log(`SmartPark API listening at http://localhost:${env.API_PORT}`);
    console.log(`Environment: ${env.NODE_ENV}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down SmartPark API...`);
    stopVisionStaleMonitor();
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
}

export default app;
