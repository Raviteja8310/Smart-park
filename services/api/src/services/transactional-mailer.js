import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { renderTransactionalEmail } from './transactional-email.js';

let transport;
function getTransport() {
  if (!env.SMTP_HOST) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
  }
  return transport;
}

export async function sendTransactionalEmail(record, { logger = console } = {}) {
  const rendered = renderTransactionalEmail(record.template_key, record.template_data);
  const mailTransport = getTransport();
  if (!mailTransport) {
    if (env.NODE_ENV === 'development') {
      logger.info(`\n[SmartPark development email; not delivered]\nTo: ${record.recipient_email}\nSubject: ${rendered.subject}\n${rendered.text}\n`);
      return { simulated: true, messageId: null };
    }
    throw new Error('SMTP email delivery is not configured.');
  }
  const result = await mailTransport.sendMail({
    from: env.MAIL_FROM,
    to: record.recipient_email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers: {
      'X-SmartPark-Event': String(record.template_key).slice(0, 80),
      'X-SmartPark-Outbox-ID': String(record.id).slice(0, 80)
    }
  });
  return { simulated: false, messageId: result.messageId ?? null };
}
