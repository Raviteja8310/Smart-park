import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import { createOpaqueToken, hashOpaqueToken } from '../src/security/tokens.js';

test('password hashes are salted and can be verified', async () => {
  const one = await hashPassword('A secure parking passphrase 2026');
  const two = await hashPassword('A secure parking passphrase 2026');
  assert.notEqual(one, two, 'independent hashes should not match because their salts differ');
  assert.equal(await verifyPassword('A secure parking passphrase 2026', one), true);
  assert.equal(await verifyPassword('incorrect password', one), false);
});

test('malformed password hashes fail closed', async () => {
  assert.equal(await verifyPassword('any password', 'not-a-password-hash'), false);
  assert.equal(await verifyPassword('any password', null), false);
});

test('opaque tokens are random and stored safely as hashes', () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.equal(first.length > 30, true);
  assert.notEqual(first, second);
  assert.equal(hashOpaqueToken(first).length, 64);
  assert.notEqual(hashOpaqueToken(first), first);
});
