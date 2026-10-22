# SmartPark account security and settings update

## Profile

- Edit the signed-in user's name and phone number from **My profile**.
- Change password from **My profile** only. The backend requires the current password and a new password of at least 12 characters.
- On successful password change, SmartPark revokes the account's other browser sessions while preserving the current session.
- Email and role assignments remain read-only in the profile editor.

## Forgot-password email OTP

1. From the sign-in screen select **Forgot password?** and enter the account email.
2. SmartPark returns a non-enumerating response and emails a six-digit code to an active account when configured.
3. Enter the code, choose a new 12+ character password, and confirm it.
4. Codes expire after 10 minutes, are single-use, and are limited to five incorrect attempts. Requesting a new code invalidates the previous code.
5. Password recovery signs out all existing browser sessions for that account.

In local development without SMTP, the code is written to the API terminal for development testing only. Production deployment requires working SMTP credentials. Email delivery failures are logged server-side and the unused reset code is removed.

## Themes and settings

- The top-bar theme control switches between light and dark modes immediately.
- The Settings page offers theme, interface language, notification-feed display filters, compact tables, high contrast, larger text, and reduced-motion preferences.
- Preferences are stored in `localStorage` in the user's current browser. The settings export contains the browser preferences and account email only; it is not a full database export.
- Notification-feed filters hide selected booking or operational notification categories only. They do not disable transactional email, payment receipts, security notifications, or server-side monitoring.

## Database migration

Migration `020_password_reset_otp.sql` adds `attempt_count` to the existing `password_reset_tokens` table. Take a backup and inspect `schema_migrations` before applying it. Use `npm run migrate` from the project root. If a schema has been manually baselined, follow `docs/production-deployment.md` and verify that the column does not already exist before manually applying the SQL.

## Validation

From the project root:

```powershell
npm run check:syntax
npm run test:api
npm run build
```

For live testing, use a test account, verify the code delivery through configured SMTP, enter wrong codes up to the attempt limit, confirm expired codes are rejected, verify that code reuse fails, and confirm password change retains the current session but invalidates other sessions.
