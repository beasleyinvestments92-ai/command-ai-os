import express from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { runAgent } from '../ai/orchestrator.js';
import { constructStripeEvent, processStripeEvent } from '../integrations/stripe.js';
import { id } from '../utils/ids.js';
import { cleanText, normalizePhone } from '../utils/text.js';
import { asyncRoute, HttpError } from '../utils/http.js';
import { timingSafeEqualText } from '../security.js';

export const stripeWebhookRouter = express.Router();
stripeWebhookRouter.post('/stripe', express.raw({ type: 'application/json', limit: '2mb' }), asyncRoute(async (req, res) => {
  const signature = req.get('stripe-signature');
  let event;
  try { event = constructStripeEvent(req.body, signature); } catch (error) { throw new HttpError(400, `Stripe webhook verification failed: ${error.message}`); }
  const existing = await one(`SELECT id FROM webhook_events WHERE provider='stripe' AND event_id=$1`, [event.id]);
  if (existing) return res.json({ received: true, duplicate: true });
  const webhookId = id('webhook');
  await query(`INSERT INTO webhook_events(id,provider,event_id,signature_valid,payload,status) VALUES($1,'stripe',$2,true,$3,'processing')`, [webhookId, event.id, JSON.stringify(event)]);
  try {
    const result = await processStripeEvent(event);
    await query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [webhookId]);
    res.json({ received: true, result });
  } catch (error) {
    await query(`UPDATE webhook_events SET status='failed',error=$1,processed_at=now() WHERE id=$2`, [cleanText(error.message, 1000), webhookId]);
    throw error;
  }
}));

export const providerWebhookRouter = express.Router();
providerWebhookRouter.use(express.urlencoded({ extended: false, limit: '1mb' }));
providerWebhookRouter.use(express.json({ limit: '2mb' }));

function validateTwilio(req) {
  if (!config.twilio.validateWebhooks) return true;
  const signature = req.get('x-twilio-signature');
  const url = `${config.appUrl}${req.originalUrl}`;
  return Boolean(signature && config.twilio.authToken && twilio.validateRequest(config.twilio.authToken, signature, url, req.body || {}));
}

async function resolveAgent(req, channel) {
  if (req.query.agent) return one(`SELECT a.*,c.business_name,t.settings AS tenant_settings FROM agents a JOIN clients c ON c.id=a.client_id JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 AND a.status='Active' AND c.status='Live' AND a.channels @> $2::jsonb`, [req.query.agent, JSON.stringify([channel])]);
  return one(`SELECT a.*,c.business_name,t.settings AS tenant_settings FROM agents a JOIN clients c ON c.id=a.client_id JOIN tenants t ON t.id=a.tenant_id WHERE a.status='Active' AND c.status='Live' AND a.channels @> $1::jsonb ORDER BY a.created_at LIMIT 1`, [JSON.stringify([channel])]);
}

async function externalConversation(agent, externalId, channel, contactName) {
  let conversation = await one('SELECT * FROM conversations WHERE external_id=$1 AND agent_id=$2', [externalId, agent.id]);
  if (!conversation) conversation = await one(`INSERT INTO conversations(id,tenant_id,client_id,agent_id,external_id,channel,status,summary,metadata) VALUES($1,$2,$3,$4,$5,$6,'Open','New inbound conversation',$7) RETURNING *`, [id('conv'), agent.tenant_id, agent.client_id, agent.id, externalId, channel, JSON.stringify({ contactName })]);
  return conversation;
}

providerWebhookRouter.post('/twilio/sms', asyncRoute(async (req, res) => {
  if (!validateTwilio(req)) throw new HttpError(403, 'Invalid Twilio signature.');
  const agent = await resolveAgent(req, 'SMS');
  const response = new twilio.twiml.MessagingResponse();
  if (!agent) { response.message('This line is not configured.'); return res.type('text/xml').send(response.toString()); }
  const from = normalizePhone(req.body.From);
  const body = cleanText(req.body.Body, config.limits.agentMessageChars);
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(body)) {
    await query(`UPDATE contacts SET consent=consent || '{"sms":false}'::jsonb,updated_at=now() WHERE client_id=$1 AND phone=$2`, [agent.client_id, from]);
    return res.type('text/xml').send(response.toString());
  }
  const conversation = await externalConversation(agent, `${from}:${normalizePhone(req.body.To)}`, 'SMS', from || 'SMS contact');
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction,provider_message_id) VALUES($1,$2,$3,'user',$4,'inbound',$5)`, [id('msg'), agent.tenant_id, conversation.id, body, req.body.MessageSid || null]);
  const result = await runAgent({ tenantId: agent.tenant_id, agentId: agent.id, conversationId: conversation.id, message: body, contactName: from, channel: 'SMS' });
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction,metadata) VALUES($1,$2,$3,'assistant',$4,'outbound',$5)`, [id('msg'), agent.tenant_id, conversation.id, result.text, JSON.stringify({ mode: result.mode, confidence: result.confidence })]);
  response.message(result.text.slice(0, 1500));
  res.type('text/xml').send(response.toString());
}));

providerWebhookRouter.post('/twilio/voice', asyncRoute(async (req, res) => {
  if (!validateTwilio(req)) throw new HttpError(403, 'Invalid Twilio signature.');
  const agent = await resolveAgent(req, 'Voice');
  const response = new twilio.twiml.VoiceResponse();
  if (!agent) { response.say('This line is not configured. Goodbye.'); return res.type('text/xml').send(response.toString()); }
  const disclosure = agent.tenant_settings?.recordingDisclosureEnabled ? ' This call may be recorded and assisted by artificial intelligence.' : '';
  const gather = response.gather({ input: 'speech', action: `/webhooks/twilio/voice/respond?agent=${encodeURIComponent(agent.id)}`, method: 'POST', speechTimeout: 'auto', actionOnEmptyResult: true, language: 'en-US' });
  gather.say(`${agent.greeting}${disclosure}`);
  response.say('I did not hear a response. Please call again when you are ready.');
  res.type('text/xml').send(response.toString());
}));

providerWebhookRouter.post('/twilio/voice/respond', asyncRoute(async (req, res) => {
  if (!validateTwilio(req)) throw new HttpError(403, 'Invalid Twilio signature.');
  const agent = await resolveAgent(req, 'Voice');
  const response = new twilio.twiml.VoiceResponse();
  if (!agent) { response.say('This line is not configured. Goodbye.'); return res.type('text/xml').send(response.toString()); }
  const speech = cleanText(req.body.SpeechResult, config.limits.agentMessageChars);
  if (!speech) {
    const gather = response.gather({ input: 'speech', action: `/webhooks/twilio/voice/respond?agent=${encodeURIComponent(agent.id)}`, method: 'POST', speechTimeout: 'auto', actionOnEmptyResult: true });
    gather.say('I did not catch that. Please say how I can help.');
    return res.type('text/xml').send(response.toString());
  }
  const callSid = req.body.CallSid || id('call');
  const conversation = await externalConversation(agent, callSid, 'Voice', normalizePhone(req.body.From) || 'Caller');
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction,provider_message_id,metadata) VALUES($1,$2,$3,'user',$4,'inbound',$5,$6)`, [id('msg'), agent.tenant_id, conversation.id, speech, callSid, JSON.stringify({ speechConfidence: req.body.Confidence || null })]);
  const result = await runAgent({ tenantId: agent.tenant_id, agentId: agent.id, conversationId: conversation.id, message: speech, contactName: normalizePhone(req.body.From) || 'Caller', channel: 'Voice' });
  await query(`INSERT INTO messages(id,tenant_id,conversation_id,role,content,direction,metadata) VALUES($1,$2,$3,'assistant',$4,'outbound',$5)`, [id('msg'), agent.tenant_id, conversation.id, result.text, JSON.stringify({ mode: result.mode, confidence: result.confidence })]);
  if (result.requiresHandoff && agent.handoff_number) {
    response.say('I am connecting you with a team member now.');
    response.dial(agent.handoff_number);
  } else {
    const gather = response.gather({ input: 'speech', action: `/webhooks/twilio/voice/respond?agent=${encodeURIComponent(agent.id)}`, method: 'POST', speechTimeout: 'auto', actionOnEmptyResult: true });
    gather.say(result.text.slice(0, 3000));
    response.say('Thank you for calling. Goodbye.');
  }
  res.type('text/xml').send(response.toString());
}));

providerWebhookRouter.post('/highlevel', asyncRoute(async (req, res) => {
  const provided = req.get('x-command-webhook-secret') || req.body.secret || '';
  if (config.highLevel.webhookSecret && !timingSafeEqualText(provided, config.highLevel.webhookSecret)) throw new HttpError(401, 'Invalid HighLevel webhook secret.');
  const eventId = req.body.id || req.body.eventId || req.get('x-webhook-id') || null;
  const duplicate = eventId ? await one(`SELECT id FROM webhook_events WHERE provider='highlevel' AND event_id=$1`, [eventId]) : null;
  if (duplicate) return res.status(202).json({ accepted: true, duplicate: true });
  await query(`INSERT INTO webhook_events(id,provider,event_id,signature_valid,payload,status,processed_at) VALUES($1,'highlevel',$2,$3,$4,'processed',now())`, [id('webhook'), eventId, Boolean(config.highLevel.webhookSecret), JSON.stringify(req.body)]);
  res.status(202).json({ accepted: true });
}));
