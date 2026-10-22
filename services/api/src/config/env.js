import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { productionConfigIssues } from './production-rules.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '../../../../');
dotenv.config({ path: resolve(projectRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SMARTPARK_PROCESS: z.enum(['api', 'email-worker', 'sms-worker', 'operations-worker']).default('api'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default('smartpark'),
  DB_USER: z.string().min(1).default('smartpark_app'),
  DB_PASSWORD: z.string().default('change_this_local_password'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('SmartPark <no-reply@smartpark.local>'),
  SMS_PROVIDER: z.enum(['none', 'twilio']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM_NUMBER: z.string().default(''),
  GATE_DEVICE_SERVICE_TOKEN: z.string().default(''),
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  QR_SIGNING_SECRET: z.string().min(32).default('local-development-only-smartpark-qr-secret-change-before-deployment'),
  VISION_API_TOKEN: z.string().default(''),
  ALLOW_DRIVER_BOOKINGS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).superRefine((value, ctx) => {
  for (const issue of productionConfigIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
  if (value.SMS_PROVIDER === 'twilio') {
    if (!value.TWILIO_ACCOUNT_SID) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TWILIO_ACCOUNT_SID'], message: 'TWILIO_ACCOUNT_SID is required when SMS_PROVIDER=twilio.' });
    if (!value.TWILIO_AUTH_TOKEN) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TWILIO_AUTH_TOKEN'], message: 'TWILIO_AUTH_TOKEN is required when SMS_PROVIDER=twilio.' });
    if (!/^\+[1-9][0-9]{7,14}$/.test(value.TWILIO_FROM_NUMBER)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TWILIO_FROM_NUMBER'], message: 'TWILIO_FROM_NUMBER must be an E.164 phone number.' });
  }
  if (value.SMARTPARK_PROCESS !== 'email-worker' && value.SMARTPARK_PROCESS !== 'sms-worker' && value.SMARTPARK_PROCESS !== 'operations-worker' && value.PAYMENT_PROVIDER === 'razorpay') {
    if (!value.RAZORPAY_KEY_ID) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RAZORPAY_KEY_ID'], message: 'RAZORPAY_KEY_ID is required when Razorpay is enabled.' });
    if (!value.RAZORPAY_KEY_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RAZORPAY_KEY_SECRET'], message: 'RAZORPAY_KEY_SECRET is required when Razorpay is enabled.' });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function canPurchaseParking(user) {
  return env.ALLOW_DRIVER_BOOKINGS || user?.roles?.some((role) => ['host', 'admin'].includes(role));
}
