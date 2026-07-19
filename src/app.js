import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { query } from './db/index.js';
import { loadSession, verifyCsrf } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { coreRouter } from './routes/core.js';
import { publicRouter } from './routes/public.js';
import { providerWebhookRouter, stripeWebhookRouter } from './routes/webhooks.js';
import { HttpError } from './utils/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const logger = pino({ level: config.logging.level, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'password', '*.password', '*.accessToken', '*.secretKey'] });

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, genReqId: (req) => req.get('x-request-id') || crypto.randomUUID() }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(compression());

  // Stripe needs the unmodified request body for signature verification.
  app.use('/webhooks', stripeWebhookRouter);

  app.use(express.json({ limit: config.limits.jsonBytes }));
  app.use(cookieParser());
  app.use(loadSession);

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', version: '1.0.0-rc.1', time: new Date().toISOString() }));
  app.get('/readyz', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ready', database: true, openAI: Boolean(config.openai.apiKey), mode: config.nodeEnv });
    } catch (error) {
      req.log.error(error);
      res.status(503).json({ status: 'not_ready', database: false });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/webhooks', providerWebhookRouter);
  app.use('/api', verifyCsrf, coreRouter);

  const sendWidget = (_req, res) => {
    // The dashboard remains protected from framing. Only the customer widget may be embedded.
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'frame-ancestors *'
    ].join('; '));
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'widget', 'index.html'));
  };
  app.get(['/widget', '/widget/'], sendWidget);

  app.use(express.static(publicDir, {
    etag: true,
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      if (filePath.endsWith('widget.js')) res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }));
  app.get('*splat', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) return next(new HttpError(404, 'Route not found.'));
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((error, req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) req.log.error({ err: error }, 'Unhandled request error');
    else req.log.warn({ err: error, status }, 'Request rejected');
    res.status(status).json({ error: error.message || 'Request failed.', code: error.code, details: config.isProduction && status >= 500 ? undefined : error.details });
  });

  return app;
}
