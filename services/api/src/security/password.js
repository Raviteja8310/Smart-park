import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * Password hashing with Node's scrypt implementation. The encoded value stores
 * its algorithm parameters so a future migration can validate old hashes.
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY
  });

  return [
    'scrypt', COST, BLOCK_SIZE, PARALLELIZATION,
    salt.toString('base64url'), Buffer.from(derived).toString('base64url')
  ].join('$');
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (
    !Number.isSafeInteger(cost) || cost < 2 ** 14 || cost > 2 ** 18 ||
    !Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 16 ||
    !Number.isSafeInteger(parallelization) || parallelization < 1 || parallelization > 4
  ) return false;

  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;

    const actual = Buffer.from(await scrypt(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: MAX_MEMORY
    }));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
