import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { newDb, DataType } from 'pg-mem';
import request from 'supertest';

process.env.NODE_ENV='test';
process.env.APP_URL='http://localhost:4173';
process.env.SESSION_PEPPER='api-test-session-pepper';
process.env.INTEGRATION_ENCRYPTION_KEY='MDAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVm';
process.env.ADMIN_EMAIL='owner@example.com';
process.env.ADMIN_PASSWORD='StrongTestPassword!123';
process.env.ADMIN_NAME='Release Owner';
process.env.AUTO_MIGRATE='false';
process.env.AUTO_SEED='false';

const { setPool, closePool } = await import('../src/db/index.js');
const { migrate } = await import('../scripts/migrate.js');
const { seed } = await import('../scripts/seed.js');
const { createApp } = await import('../src/app.js');

let http;
let pool;
let csrf;

before(async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({ name: 'date_trunc', args: [DataType.text, DataType.timestamptz], returns: DataType.timestamptz, implementation: (_unit, value) => value });
  const adapter = memory.adapters.createPg();
  pool = new adapter.Pool();
  setPool(pool);
  await migrate(pool);
  await seed();
  http = request.agent(createApp());
});

after(async () => { await closePool(); });

test('health and authentication flow', async () => {
  await http.get('/healthz').expect(200).expect(({ body }) => assert.equal(body.status, 'ok'));
  const login = await http.post('/api/auth/login').send({ email: 'owner@example.com', password: 'StrongTestPassword!123' }).expect(200);
  csrf = login.body.csrfToken;
  assert.ok(csrf);
  const bootstrap = await http.get('/api/bootstrap').expect(200);
  assert.equal(bootstrap.body.user.email, 'owner@example.com');
  assert.ok(bootstrap.body.clients.length >= 1);
  assert.ok(bootstrap.body.agents.length >= 1);
  assert.ok(bootstrap.body.knowledgeDocuments.length >= 1);
});

test('CSRF protection blocks untrusted writes', async () => {
  await http.post('/api/prospects').send({ businessName: 'Blocked Business', industry: 'HVAC' }).expect(403);
});

test('prospect audit and conversion workflow', async () => {
  const created = await http.post('/api/prospects').set('x-csrf-token', csrf).send({ businessName: 'Release Plumbing', industry: 'Plumbing', city: 'Des Moines, IA', phone: '515-555-0199' }).expect(201);
  const prospectId = created.body.prospect.id;
  const audit = await http.post(`/api/prospects/${prospectId}/audit`).set('x-csrf-token', csrf).send({}).expect(200);
  assert.ok(audit.body.prospect.score >= 70);
  const conversion = await http.post(`/api/prospects/${prospectId}/convert`).set('x-csrf-token', csrf).send({ plan: 'Growth' }).expect(201);
  assert.equal(conversion.body.client.businessName, 'Release Plumbing');
});

test('grounded agent test answers known facts and refuses unknown facts', async () => {
  const bootstrap = await http.get('/api/bootstrap').expect(200);
  const agentId = bootstrap.body.agents[0].id;
  const known = await http.post(`/api/agents/${agentId}/test`).set('x-csrf-token', csrf).send({ message: 'What services do you provide?' }).expect(200);
  assert.equal(known.body.result.requiresHandoff, false);
  assert.match(known.body.result.text, /drain cleaning|leak repair|water heater/i);
  const unknown = await http.post(`/api/agents/${agentId}/test`).set('x-csrf-token', csrf).send({ message: 'What is the owner personal home address?' }).expect(200);
  assert.equal(unknown.body.result.requiresHandoff, true);
});

test('public widget creates a persistent conversation', async () => {
  const bootstrap = await http.get('/api/bootstrap').expect(200);
  const agent = bootstrap.body.agents[0];
  const config = await request(createApp()).get(`/api/public/widget/${agent.widgetToken}/config`).expect(200);
  assert.equal(config.body.agent.name, agent.name);
  const reply = await request(createApp()).post(`/api/public/widget/${agent.widgetToken}/message`).send({ message: 'What are your hours?', contactName: 'Website tester' }).expect(200);
  assert.ok(reply.body.conversationId);
  assert.match(reply.body.reply, /hours|Monday|configured/i);
});

test('widget can be framed while the dashboard remains frame-protected', async () => {
  const app = createApp();
  const dashboard = await request(app).get('/').expect(200);
  assert.match(dashboard.headers['x-frame-options'] || '', /SAMEORIGIN/i);
  const widget = await request(app).get('/widget').expect(200);
  assert.equal(widget.headers['x-frame-options'], undefined);
  assert.match(widget.headers['content-security-policy'] || '', /frame-ancestors \*/i);
});

test('widget origin allowlist rejects unauthorized websites', async () => {
  await http.put('/api/settings').set('x-csrf-token', csrf).send({ allowedWidgetOrigins: ['https://allowed.example'] }).expect(200);
  const bootstrap = await http.get('/api/bootstrap').expect(200);
  const agent = bootstrap.body.agents[0];
  await request(createApp()).get(`/api/public/widget/${agent.widgetToken}/config`).set('x-widget-origin', 'https://blocked.example').expect(403);
  await request(createApp()).get(`/api/public/widget/${agent.widgetToken}/config`).set('x-widget-origin', 'https://allowed.example').expect(200);
  await http.put('/api/settings').set('x-csrf-token', csrf).send({ allowedWidgetOrigins: [] }).expect(200);
});
