import { Router } from 'express';
import { pingDatabase } from '../config/database.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    await pingDatabase();
    return res.status(200).json({
      status: 'ok',
      service: 'SmartPark API',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Do not return database credentials or raw driver errors to the client.
    console.error('Database health check failed:', error.code ?? error.message);
    return res.status(503).json({
      status: 'degraded',
      service: 'SmartPark API',
      database: 'unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
