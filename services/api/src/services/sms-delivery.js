import { env } from '../config/env.js';

export async function sendSms({ to, body }, fetchImpl = fetch) {
  if (env.SMS_PROVIDER !== 'twilio') throw Object.assign(new Error('SMS provider is not configured.'), { code: 'SMS_PROVIDER_DISABLED' });
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) throw Object.assign(new Error('Twilio SMS configuration is incomplete.'), { code: 'SMS_CONFIGURATION_INVALID' });
  if (!/^\+[1-9][0-9]{7,14}$/.test(String(to ?? ''))) throw Object.assign(new Error('Recipient must be in international E.164 format.'), { code: 'SMS_RECIPIENT_INVALID' });
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: String(body ?? '').slice(0, 1400) });
  const authorization = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`SMS provider returned HTTP ${response.status}.`), { code: `TWILIO_HTTP_${response.status}` });
  return { messageId: payload.sid ?? null, status: payload.status ?? 'queued' };
}
