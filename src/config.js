import crypto from 'node:crypto';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 4173}`).replace(/\/$/, '');

export const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: int(process.env.PORT, 4173),
  appUrl,
  trustProxy: bool(process.env.TRUST_PROXY, nodeEnv === 'production'),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, nodeEnv === 'production'),
  cookieName: process.env.SESSION_COOKIE_NAME || 'command_session',
  cookieSecure: bool(process.env.COOKIE_SECURE, appUrl.startsWith('https://')),
  sessionDays: int(process.env.SESSION_DAYS, 7),
  sessionPepper: process.env.SESSION_PEPPER || (nodeEnv === 'test' ? 'test-session-pepper' : ''),
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY || '',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Agency Owner',
  defaultTenantName: process.env.DEFAULT_TENANT_NAME || 'COMMAND AI',
  defaultTenantSlug: process.env.DEFAULT_TENANT_SLUG || 'command-ai',
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    moderationModel: process.env.OPENAI_MODERATION_MODEL || 'omni-moderation-latest',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    store: bool(process.env.OPENAI_STORE, false),
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'low'
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    validateWebhooks: bool(process.env.TWILIO_VALIDATE_WEBHOOKS, nodeEnv === 'production')
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      Receptionist: process.env.STRIPE_PRICE_RECEPTIONIST || '',
      Growth: process.env.STRIPE_PRICE_GROWTH || '',
      Operator: process.env.STRIPE_PRICE_OPERATOR || '',
      'Multi-location': process.env.STRIPE_PRICE_MULTI_LOCATION || ''
    }
  },
  highLevel: {
    baseURL: (process.env.HIGHLEVEL_BASE_URL || 'https://services.leadconnectorhq.com').replace(/\/$/, ''),
    accessToken: process.env.HIGHLEVEL_ACCESS_TOKEN || '',
    locationId: process.env.HIGHLEVEL_LOCATION_ID || '',
    calendarId: process.env.HIGHLEVEL_CALENDAR_ID || '',
    apiVersion: process.env.HIGHLEVEL_API_VERSION || '2021-07-28',
    webhookSecret: process.env.HIGHLEVEL_WEBHOOK_SECRET || ''
  },
  limits: {
    jsonBytes: process.env.JSON_LIMIT || '2mb',
    uploadBytes: int(process.env.UPLOAD_MAX_BYTES, 8 * 1024 * 1024),
    knowledgeDocumentChars: int(process.env.KNOWLEDGE_MAX_CHARS, 500_000),
    agentMessageChars: int(process.env.AGENT_MESSAGE_MAX_CHARS, 4_000),
    conversationsPerMinute: int(process.env.AGENT_RATE_LIMIT_PER_MINUTE, 30)
  },
  logging: {
    level: process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug')
  }
});

export function validateConfig() {
  const errors = [];
  if (!config.databaseUrl && config.nodeEnv !== 'test') errors.push('DATABASE_URL is required.');
  if (!config.sessionPepper) errors.push('SESSION_PEPPER is required.');
  if (config.isProduction && config.sessionPepper.length < 32) errors.push('SESSION_PEPPER must be at least 32 characters in production.');
  if (config.isProduction && !config.integrationEncryptionKey) errors.push('INTEGRATION_ENCRYPTION_KEY is required in production.');
  if (config.integrationEncryptionKey && !/^[A-Za-z0-9+/=_-]{32,}$/.test(config.integrationEncryptionKey)) {
    errors.push('INTEGRATION_ENCRYPTION_KEY must be a base64/base64url string representing at least 32 bytes.');
  }
  if (config.isProduction && !config.cookieSecure) errors.push('Secure cookies must be enabled in production.');
  if (errors.length) throw new Error(`Configuration error:\n- ${errors.join('\n- ')}`);
}

export function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
