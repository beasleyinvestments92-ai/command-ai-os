import { HttpError } from '../utils/http.js';

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 60, key = (req) => req.ip, message = 'Too many requests. Try again shortly.' } = {}) {
  return (req, _res, next) => {
    const now = Date.now();
    const bucketKey = key(req);
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) return next(new HttpError(429, message));
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
}, 60_000).unref();
