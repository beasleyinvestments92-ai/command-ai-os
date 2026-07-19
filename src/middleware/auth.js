import { DateTime } from 'luxon';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { hashToken } from '../security.js';
import { HttpError } from '../utils/http.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function loadSession(req, _res, next) {
  try {
    const raw = req.cookies?.[config.cookieName];
    if (!raw) return next();
    const session = await one(`
      SELECT s.id AS session_id, s.csrf_token, s.expires_at,
             u.id AS user_id, u.email, u.full_name, u.platform_role, u.disabled,
             m.tenant_id, m.role AS tenant_role,
             t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN memberships m ON m.user_id = u.id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
      LIMIT 1
    `, [hashToken(raw)]);
    if (!session || session.disabled || session.tenant_status !== 'active') return next();
    req.auth = {
      sessionId: session.session_id,
      csrfToken: session.csrf_token,
      user: {
        id: session.user_id,
        email: session.email,
        fullName: session.full_name,
        platformRole: session.platform_role
      },
      tenant: {
        id: session.tenant_id,
        name: session.tenant_name,
        slug: session.tenant_slug,
        role: session.tenant_role
      }
    };
    if (DateTime.fromJSDate(new Date(session.expires_at)).diffNow('days').days < 1) {
      await query('UPDATE sessions SET expires_at = now() + ($1 || \' days\')::interval, last_seen_at = now() WHERE id = $2', [config.sessionDays, session.session_id]);
    } else {
      await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [session.session_id]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) return next(new HttpError(401, 'Authentication required.', undefined, 'AUTH_REQUIRED'));
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, 'Authentication required.'));
    if (req.auth.user.platformRole === 'platform_admin' || roles.includes(req.auth.tenant.role)) return next();
    next(new HttpError(403, 'You do not have permission to perform this action.'));
  };
}

export function verifyCsrf(req, _res, next) {
  if (safeMethods.has(req.method)) return next();
  if (!req.auth) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.appUrl) return next(new HttpError(403, 'Origin check failed.'));
  const provided = req.get('x-csrf-token');
  if (!provided || provided !== req.auth.csrfToken) return next(new HttpError(403, 'CSRF token is missing or invalid.'));
  next();
}

export function setSessionCookie(res, rawToken) {
  res.cookie(config.cookieName, rawToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
}
