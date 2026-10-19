import { pool } from '../config/database.js';

const [rawEmail, roleKey] = process.argv.slice(2);
const allowedRoles = new Set(['driver', 'host', 'attendant', 'operator', 'admin']);

try {
  if (!rawEmail || !roleKey || !allowedRoles.has(roleKey)) {
    console.error('Usage: npm run role:grant -- user@example.com <driver|host|attendant|operator|admin>');
    process.exitCode = 2;
  } else {
    const email = rawEmail.trim().toLowerCase();
    const [users] = await pool.execute('SELECT id, account_status FROM users WHERE email = ? LIMIT 1', [email]);
    if (!users.length) {
      console.error(`No account found for ${email}. Register and verify the account first.`);
      process.exitCode = 1;
    } else if (users[0].account_status !== 'active') {
      console.error('The account must be email-verified and active before assigning a role.');
      process.exitCode = 1;
    } else {
      const [roles] = await pool.execute('SELECT id FROM roles WHERE role_key = ? LIMIT 1', [roleKey]);
      if (!roles.length) throw new Error(`Role ${roleKey} was not seeded. Apply database migrations first.`);
      await pool.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE assigned_at = assigned_at',
        [users[0].id, roles[0].id]
      );
      await pool.execute(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (NULL, ?, ?, ?, ?)',
        ['role.granted_via_cli', 'user', users[0].id, JSON.stringify({ roleKey, email })]
      );
      console.log(`Granted role "${roleKey}" to ${email}.`);
    }
  }
} catch (error) {
  console.error('Role assignment failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
