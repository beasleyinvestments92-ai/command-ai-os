import crypto from 'node:crypto';

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
