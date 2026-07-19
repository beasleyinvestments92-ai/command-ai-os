import express from 'express';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { hashToken, verifyPassword, hashPassword } from '../security.js';
import { id, token } from '../utils/ids.js';
import { normalizeEmail, cleanText } from '../utils/text.js';
import { asyncRoute, HttpError } from '../utils/http.js';
import { setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { auditLog } from '../services/audit-log.js';

export const authRouter = express.Router();

const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, key: (req) => `login:${req.ip}`, message: 'Too many login attempts. Try again later.' });

authRouter.post('/login', loginLimit, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const user = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!user || user.disabled || !(await verifyPassword(user.password_hash, password))) throw new HttpError(401, 'Email or password is incorrect.');
  const membership = await one(`SELECT m.*,t.name AS tenant_name,t.slug AS tenant_slug FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.status='active' ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`, [user.id]);
  if (!membership) throw new HttpError(403, 'No active workspace is assigned to this user.');
  const rawToken = token(32);
  const csrf = token(24);
  await query(`INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id('session'), user.id, hashToken(rawToken), csrf, DateTime.now().plus({ days: config.sessionDays }).toJSDate(), req.ip, cleanText(req.get('user-agent'), 500)]);
  await query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  setSessionCookie(res, rawToken);
  req.auth = { user: { id: user.id }, tenant: { id: membership.tenant_id } };
  await auditLog(req, 'auth.login', 'user', user.id);
  res.json({ user: { id: user.id, email: user.email, fullName: user.full_name, platformRole: user.platform_role }, tenant: { id: membership.tenant_id, name: membership.tenant_name, slug: membership.tenant_slug, role: membership.role }, csrfToken: csrf });
}));

authRouter.get('/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: req.auth.user, tenant: req.auth.tenant, csrfToken: req.auth.csrfToken });
}));

authRouter.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  await query('DELETE FROM sessions WHERE id=$1', [req.auth.sessionId]);
  await auditLog(req, 'auth.logout', 'user', req.auth.user.id);
  clearSessionCookie(res);
  res.status(204).end();
}));

authRouter.post('/accept-invitation', asyncRoute(async (req, res) => {
  const rawToken = cleanText(req.body.token, 500);
  const invitation = await one(`SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()`, [hashToken(rawToken)]);
  if (!invitation) throw new HttpError(400, 'Invitation is invalid or expired.');
  const email = normalizeEmail(invitation.email);
  let user = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!user) user = await one(`INSERT INTO users(id,email,password_hash,full_name) VALUES($1,$2,$3,$4) RETURNING *`, [id('user'), email, await hashPassword(String(req.body.password || '')), cleanText(req.body.fullName, 120)]);
  await query(`INSERT INTO memberships(user_id,tenant_id,role) VALUES($1,$2,$3) ON CONFLICT(user_id,tenant_id) DO UPDATE SET role=EXCLUDED.role`, [user.id, invitation.tenant_id, invitation.role]);
  await query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [invitation.id]);
  res.status(201).json({ accepted: true });
}));
