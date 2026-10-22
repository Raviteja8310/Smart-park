import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseDotEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

const filePath = resolve(process.cwd(), '.env');
let fileValues;
try {
  fileValues = parseDotEnv(await readFile(filePath, 'utf8'));
} catch {
  console.error('Preflight failed: .env was not found. Copy .env.example to .env and configure production values.');
  process.exit(1);
}
const value = (key) => process.env[key] ?? fileValues[key] ?? '';
const issues = [];
const required = (key, message = `${key} is required`) => { if (!value(key).trim()) issues.push(message); };
const strong = (key, minimum = 32) => {
  const current = value(key);
  if (current.length < minimum || /(change_this|local-development|replace-with|placeholder|example\.com|your-domain|local_root)/i.test(current)) {
    issues.push(`${key} must be a unique secret/value with at least ${minimum} characters; sample values are not accepted.`);
  }
};

required('APP_DOMAIN', 'APP_DOMAIN must be a real public DNS name.');
required('WEB_ORIGIN', 'WEB_ORIGIN must be the exact HTTPS origin of APP_DOMAIN.');
required('DB_NAME');
required('DB_USER');
required('DB_PASSWORD');
required('MYSQL_ROOT_PASSWORD');
required('SMTP_HOST');
required('SMTP_USER');
required('SMTP_PASSWORD');
required('MAIL_FROM');
required('RAZORPAY_KEY_ID');
required('RAZORPAY_KEY_SECRET');
required('RAZORPAY_WEBHOOK_SECRET');
required('QR_SIGNING_SECRET');
required('VISION_API_TOKEN');

if (value('NODE_ENV') !== 'production') issues.push('Set NODE_ENV=production.');
if (value('PAYMENT_PROVIDER') !== 'razorpay') issues.push('Set PAYMENT_PROVIDER=razorpay. Mock checkout cannot be deployed.');
const domain = value('APP_DOMAIN').trim().toLowerCase();
if (domain && (!domain.includes('.') || /(^|\.)(example|test|invalid|local)(\.|$)/.test(domain) || /localhost/.test(domain) || /[^a-z0-9.-]/.test(domain))) {
  issues.push('APP_DOMAIN must be a real DNS hostname, not localhost or an example/test domain.');
}
const expectedOrigin = `https://${value('APP_DOMAIN').trim()}`;
if (value('WEB_ORIGIN') !== expectedOrigin) issues.push('WEB_ORIGIN must exactly equal https://${APP_DOMAIN} (no trailing slash or path).');
if (value('DB_PASSWORD').length < 24 || /(change_this|password123|example|placeholder)/i.test(value('DB_PASSWORD'))) issues.push('DB_PASSWORD must be a strong non-sample password with at least 24 characters.');
strong('MYSQL_ROOT_PASSWORD', 24);
strong('QR_SIGNING_SECRET', 32);
strong('VISION_API_TOKEN', 32);
if (value('QR_SIGNING_SECRET') && value('VISION_API_TOKEN') && value('QR_SIGNING_SECRET') === value('VISION_API_TOKEN')) issues.push('QR_SIGNING_SECRET and VISION_API_TOKEN must be different.');
if (value('DB_PASSWORD') && value('MYSQL_ROOT_PASSWORD') && value('DB_PASSWORD') === value('MYSQL_ROOT_PASSWORD')) issues.push('DB_PASSWORD and MYSQL_ROOT_PASSWORD must be different.');
const placeholder = /(change_this|local-development|replace-with|placeholder|example\.com|your-domain|password123|local_root)/i;
for (const key of ['SMTP_PASSWORD', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
  if (placeholder.test(value(key))) issues.push(`${key} cannot use a sample or placeholder value.`);
}
const uniqueSecrets = ['DB_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'SMTP_PASSWORD', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'QR_SIGNING_SECRET', 'VISION_API_TOKEN']
  .map((key) => [key, value(key)])
  .filter(([, secret]) => Boolean(secret));
for (let i = 0; i < uniqueSecrets.length; i += 1) {
  for (let j = i + 1; j < uniqueSecrets.length; j += 1) {
    if (uniqueSecrets[i][1] === uniqueSecrets[j][1]) {
      issues.push(`${uniqueSecrets[i][0]} and ${uniqueSecrets[j][0]} must be different secrets.`);
    }
  }
}
if (/smartpark\.local|your-domain\.example/i.test(value('MAIL_FROM'))) issues.push('MAIL_FROM must use an address on a domain configured for outbound email.');

if (issues.length) {
  console.error(`SmartPark production preflight failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  for (const issue of [...new Set(issues)]) console.error(`- ${issue}`);
  console.error('No secret values were printed.');
  process.exit(1);
}
console.log('SmartPark production configuration preflight passed.');
console.log(`Domain: ${value('APP_DOMAIN')}`);
console.log('Payment mode: Razorpay (credentials were not displayed)');
console.log('Reminder: this preflight does not test DNS, SMTP delivery, payment credentials, migrations, or camera accuracy.');
