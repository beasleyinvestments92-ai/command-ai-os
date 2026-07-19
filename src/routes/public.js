import express from 'express';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { runAgent } from '../ai/orchestrator.js';
import { id } from '../utils/ids.js';
import { cleanText } from '../utils/text.js';
import { asyncRoute, HttpError } from '../utils/http.js';

export const publicRouter = express.Router();
const widgetLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => `widget:${req.params.token}:${req.ip}` });

async function widgetAgent(token) {
  return one(`SELECT a.*,c.business_name,c.id AS business_id,t.brand,t.settings AS tenant_settings
              FROM agents a JOIN clients c ON c.id=a.client_id JOIN tenants t ON t.id=a.tenant_id
              WHERE a.widget_token=$1 AND a.status='Active' AND c.status='Live' AND t.status='active'`, [token]);
}

function widgetOrigin(req) {
  return cleanText(req.get('x-widget-origin') || req.get('origin') || '', 500).replace(/\/$/, '');
}

function setWidgetCors(req, res, settings) {
  const requestOrigin = req.get('origin');
  const allowed = (settings?.allowedWidgetOrigins || []).map((value) => String(value).replace(/\/$/, ''));
  if (requestOrigin && (allowed.length === 0 || allowed.includes(requestOrigin.replace(/\/$/, '')))) {
    res.set('Access-Control-Allow-Origin', requestOrigin);
  }
  res.set('Vary', 'Origin, X-Widget-Origin');
}

function enforceWidgetOrigin(req, settings) {
  const origin = widgetOrigin(req);
  const allowed = (settings?.allowedWidgetOrigins || []).map((value) => String(value).replace(/\/$/, ''));
  if (allowed.length && (!origin || !allowed.includes(origin))) throw new HttpError(403, 'This website is not authorized to use this chat agent.');
  return origin;
}

publicRouter.options('/widget/:token/*splat', asyncRoute(async (req, res) => {
  const agent = await widgetAgent(req.params.token);
  if (!agent) return res.status(404).end();
  setWidgetCors(req, res, agent.tenant_settings);
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Widget-Origin');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.status(204).end();
}));

publicRouter.get('/widget/:token/config', widgetLimit, asyncRoute(async (req, res) => {
  const row = await widgetAgent(req.params.token);
  if (!row) throw new HttpError(404, 'Agent not found.');
  setWidgetCors(req, res, row.tenant_settings);
  enforceWidgetOrigin(req, row.tenant_settings);
  res.json({ agent: { name: row.name, greeting: row.greeting, role: row.role }, business: { name: row.business_name }, brand: row.brand });
}));

publicRouter.post('/widget/:token/message', widgetLimit, asyncRoute(async (req, res) => {
  const row = await widgetAgent(req.params.token);
  if (!row) throw new HttpError(404, 'Agent not found.');
  setWidgetCors(req, res, row.tenant_settings);
  const origin = enforceWidgetOrigin(req, row.tenant_settings);
  const text = cleanText(req.body.message, config.limits.agentMessageChars);
  if (!text) throw new HttpError(400, 'Message is required.');
  let conversation = null;
  if (req.body.conversationId) conversation = await one('SELECT * FROM conversations WHERE id=$1 AND agent_id=$2', [req.body.conversationId, row.id]);
  if (!conversation) {
    conversation = await one(`INSERT INTO conversations(id,tenant_id,client_id,agent_id,channel,status,summary,metadata)
      VALUES($1,$2,$3,$4,'Web Chat','Open','New website conversation',$5) RETURNING *`, [id('conv'), row.tenant_id, row.client_id, row.id, JSON.stringify({ contactName: cleanText(req.body.contactName || 'Website visitor', 120), origin })]);
  }
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction) VALUES($1,$2,$3,'user',$4,'inbound')`, [id('msg'), row.tenant_id, conversation.id, text]);
  const result = await runAgent({ tenantId: row.tenant_id, agentId: row.id, conversationId: conversation.id, message: text, contactName: conversation.metadata?.contactName || 'Website visitor', channel: 'Web Chat' });
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction,metadata) VALUES($1,$2,$3,'assistant',$4,'outbound',$5)`, [id('msg'), row.tenant_id, conversation.id, result.text, JSON.stringify({ confidence: result.confidence, intent: result.intent, mode: result.mode })]);
  await query(`UPDATE conversations SET summary=$1,requires_handoff=$2,handoff_reason=$3,updated_at=now() WHERE id=$4`, [`Latest: ${text.slice(0, 140)}`, result.requiresHandoff, result.handoffReason || null, conversation.id]);
  res.json({ conversationId: conversation.id, reply: result.text, requiresHandoff: result.requiresHandoff });
}));
