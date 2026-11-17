import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Room passwords. They are never stored (or sent) as the text the host typed: only a salted scrypt HASH is kept, so even someone who could read the
 * server's memory couldn't read the password back, and two rooms with the same password don't look alike. Checking a guess compares hashes in
 * constant time (so how long the check takes reveals nothing about how close the guess was).
 */
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, KEY_LENGTH).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
