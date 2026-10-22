import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export async function sendVerificationEmail(email, rawToken) {
  const verifyUrl = new URL('/', env.WEB_ORIGIN);
  verifyUrl.searchParams.set('verify', rawToken);
  const link = verifyUrl.toString();

  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'development') {
      console.info(`\n[SmartPark development email]\nTo: ${email}\nVerify your account: ${link}\n`);
      return { delivered: false, developmentLinkLogged: true };
    }
    throw new Error('SMTP email delivery is not configured.');
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  });

  await transport.sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject: 'Verify your SmartPark account',
    text: `Welcome to SmartPark. Verify your email address using this link (valid for 30 minutes): ${link}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#20312b"><h2>Welcome to SmartPark</h2><p>Verify your email address to activate your account. This link expires in 30 minutes.</p><p><a href="${link}" style="background:#168761;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Verify email</a></p><p>If you did not create this account, you can ignore this message.</p></div>`
  });
  return { delivered: true, developmentLinkLogged: false };
}

export async function sendPasswordResetOtpEmail(email, otp) {
  const expiryMinutes = 10;
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'development') {
      console.info(`\n[SmartPark development email]\nTo: ${email}\nPassword reset code: ${otp}\nThis code expires in ${expiryMinutes} minutes.\n`);
      return { delivered: false, developmentCodeLogged: true };
    }
    throw new Error('SMTP email delivery is not configured.');
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined
  });
  await transport.sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject: 'Your SmartPark password reset code',
    text: `Your SmartPark password reset code is ${otp}. It expires in ${expiryMinutes} minutes and can be used only once. If you did not request this code, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#20312b;max-width:520px"><h2>Reset your SmartPark password</h2><p>Enter this one-time code in SmartPark to choose a new password.</p><div style="font-size:30px;letter-spacing:8px;font-weight:800;padding:16px 20px;border-radius:10px;background:#f0f7f2;color:#176e4d;text-align:center">${otp}</div><p>This code expires in ${expiryMinutes} minutes and can be used only once.</p><p>If you did not request this code, you can safely ignore this email.</p></div>`
  });
  return { delivered: true, developmentCodeLogged: false };
}
