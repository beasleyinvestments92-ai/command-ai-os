import crypto from 'node:crypto';

export function cleanText(value, max = 10_000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

export function normalizePhone(value) {
  const input = cleanText(value, 40);
  const plus = input.startsWith('+') ? '+' : '';
  return plus + input.replace(/\D/g, '');
}

export function slugify(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function checksum(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function splitWords(value) {
  return cleanText(value, 20_000)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]{1,}/g) || [];
}

export function redact(value) {
  return cleanText(value, 10_000)
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED CARD]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED SSN]');
}
