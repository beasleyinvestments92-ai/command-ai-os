import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';

export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashToken(raw) {
  return crypto.createHmac('sha256', config.sessionPepper).update(raw).digest('hex');
}

function encryptionKey() {
  if (!config.integrationEncryptionKey) return null;
  const normalized = config.integrationEncryptionKey.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length >= 32) return decoded.subarray(0, 32);
  return crypto.createHash('sha256').update(config.integrationEncryptionKey).digest();
}

export function encryptJson(value) {
  const key = encryptionKey();
  if (!key) throw new Error('Integration encryption is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]).toString('base64url');
}

export function decryptJson(payload) {
  const key = encryptionKey();
  if (!key || !payload) return null;
  const data = Buffer.from(payload, 'base64url');
  if (data[0] !== 1) throw new Error('Unsupported encrypted payload version.');
  const iv = data.subarray(1, 13);
  const tag = data.subarray(13, 29);
  const ciphertext = data.subarray(29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

export function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
