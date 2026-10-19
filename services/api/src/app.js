import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import healthRouter from './routes/health.routes.js';
import authRouter from './routes/auth.routes.js';
import { originGuard } from './middleware/origin-guard.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(originGuard);

app.get('/', (_req, res) => {
  res.json({
    name: 'SmartPark API',
    version: '1.1.0',
    message: 'API is running. Use /api/health for service health.'
  });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested API route was not found.' }
  });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled request error:', error?.message ?? error);
  if (res.headersSent) return;
  res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }
  });
});

export default app;
