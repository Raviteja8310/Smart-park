import express from 'express';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import healthRouter from './routes/health.routes.js';
import authRouter from './routes/auth.routes.js';
import parkingRouter from './routes/parking.routes.js';
import bookingsRouter from './routes/bookings.routes.js';
import paymentsRouter, { razorpayWebhookHandler } from './routes/payments.routes.js';
import gateRouter from './routes/gate.routes.js';
import marketplaceRouter from './routes/marketplace.routes.js';
import vehiclesRouter from './routes/vehicles.routes.js';
import visionRouter from './routes/vision.routes.js';
import operationsRouter from './routes/operations.routes.js';
import notificationsRouter from './routes/notifications.routes.js';
import financialRouter from './routes/financial.routes.js';
import engagementRouter from './routes/engagement.routes.js';
import { originGuard } from './middleware/origin-guard.js';

const app = express();

// Only trust the explicitly configured reverse-proxy hop count. This keeps rate-limit
// client identity useful behind the included Caddy -> Nginx -> API production path.
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
// Provider webhooks need the exact signed raw payload; register before express.json().
app.post('/api/payments/webhook/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhookHandler);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(originGuard);

app.get('/', (_req, res) => {
  res.json({
    name: 'SmartPark API',
    version: '2.0.0',
    message: 'API is running. Use /api/health for service health.'
  });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/parking', parkingRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/gate', gateRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/vision', visionRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/financial', financialRouter);
app.use('/api/engagement', engagementRouter);
// Shared listing photos are public assets; upload permissions are enforced by the API routes.
app.use('/uploads/marketplace', express.static(fileURLToPath(new URL('../uploads/marketplace/', import.meta.url)), { maxAge: '1d', index: false, dotfiles: 'deny' }));

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
