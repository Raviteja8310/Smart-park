const PLACEHOLDER_PATTERN = /(change_this|local-development|replace-with|placeholder|example\.com|your-domain|password123|local_root)/i;

function add(issues, path, message) {
  issues.push({ path, message });
}

export function productionConfigIssues(value) {
  const issues = [];
  if (value.NODE_ENV !== 'production') return issues;

  const processType = value.SMARTPARK_PROCESS ?? 'api';
  let webUrl;
  try {
    webUrl = new URL(value.WEB_ORIGIN);
  } catch {
    add(issues, 'WEB_ORIGIN', 'WEB_ORIGIN must be a valid HTTPS origin in production.');
  }
  if (webUrl) {
    if (webUrl.protocol !== 'https:') add(issues, 'WEB_ORIGIN', 'WEB_ORIGIN must use HTTPS in production.');
    if (webUrl.pathname !== '/' || webUrl.search || webUrl.hash) add(issues, 'WEB_ORIGIN', 'WEB_ORIGIN must be an origin only, without a path, query or fragment.');
    if (['localhost', '127.0.0.1', '::1'].includes(webUrl.hostname) || /(^|\.)(example|test|invalid|local)(\.|$)/i.test(webUrl.hostname)) {
      add(issues, 'WEB_ORIGIN', 'WEB_ORIGIN cannot point to localhost in production.');
    }
  }

  const dbPassword = String(value.DB_PASSWORD ?? '');
  if (dbPassword.length < 24 || PLACEHOLDER_PATTERN.test(dbPassword)) {
    add(issues, 'DB_PASSWORD', 'Set a unique database password of at least 24 characters; do not use a sample password.');
  }
  if (!String(value.SMTP_HOST ?? '').trim()) add(issues, 'SMTP_HOST', 'SMTP_HOST is required so account verification and password recovery can work in production.');
  if (!String(value.SMTP_USER ?? '').trim()) add(issues, 'SMTP_USER', 'SMTP_USER is required for the configured production mail account.');
  if (!String(value.SMTP_PASSWORD ?? '').trim() || PLACEHOLDER_PATTERN.test(String(value.SMTP_PASSWORD ?? ''))) {
    add(issues, 'SMTP_PASSWORD', 'Set a real SMTP_PASSWORD for the configured production mail account.');
  }
  if (!String(value.MAIL_FROM ?? '').trim() || /smartpark\.local|your-domain\.example/i.test(String(value.MAIL_FROM ?? ''))) {
    add(issues, 'MAIL_FROM', 'MAIL_FROM must use a sender address configured for your real domain.');
  }

  // The email worker only claims and delivers outbox rows. It does not need
  // payment credentials, QR signing keys, or the vision service token.
  if (processType === 'email-worker') return issues;

  if (value.PAYMENT_PROVIDER !== 'razorpay') add(issues, 'PAYMENT_PROVIDER', 'Production requires PAYMENT_PROVIDER=razorpay; simulated payments are development-only.');
  if (!String(value.RAZORPAY_KEY_ID ?? '').trim()) add(issues, 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_ID is required in production.');
  if (!String(value.RAZORPAY_KEY_SECRET ?? '').trim()) add(issues, 'RAZORPAY_KEY_SECRET', 'RAZORPAY_KEY_SECRET is required in production.');
  if (!String(value.RAZORPAY_WEBHOOK_SECRET ?? '').trim()) add(issues, 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET is required in production.');
  if (String(value.QR_SIGNING_SECRET ?? '').length < 32 || PLACEHOLDER_PATTERN.test(String(value.QR_SIGNING_SECRET ?? ''))) {
    add(issues, 'QR_SIGNING_SECRET', 'Set a unique QR_SIGNING_SECRET of at least 32 characters.');
  }
  if (String(value.VISION_API_TOKEN ?? '').length < 32 || PLACEHOLDER_PATTERN.test(String(value.VISION_API_TOKEN ?? ''))) {
    add(issues, 'VISION_API_TOKEN', 'Set a unique VISION_API_TOKEN of at least 32 characters.');
  }
  if (value.QR_SIGNING_SECRET && value.VISION_API_TOKEN && value.QR_SIGNING_SECRET === value.VISION_API_TOKEN) {
    add(issues, 'QR_SIGNING_SECRET', 'QR_SIGNING_SECRET and VISION_API_TOKEN must be different.');
  }
  const criticalSecrets = [
    ['DB_PASSWORD', value.DB_PASSWORD],
    ['SMTP_PASSWORD', value.SMTP_PASSWORD],
    ['RAZORPAY_KEY_SECRET', value.RAZORPAY_KEY_SECRET],
    ['RAZORPAY_WEBHOOK_SECRET', value.RAZORPAY_WEBHOOK_SECRET],
    ['QR_SIGNING_SECRET', value.QR_SIGNING_SECRET],
    ['VISION_API_TOKEN', value.VISION_API_TOKEN]
  ].filter(([, secret]) => typeof secret === 'string' && secret.length > 0);
  for (let i = 0; i < criticalSecrets.length; i += 1) {
    for (let j = i + 1; j < criticalSecrets.length; j += 1) {
      if (criticalSecrets[i][1] === criticalSecrets[j][1]) {
        add(issues, criticalSecrets[j][0], `${criticalSecrets[i][0]} and ${criticalSecrets[j][0]} must be different secrets.`);
      }
    }
  }
  return issues;
}
