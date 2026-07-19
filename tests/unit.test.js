import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.SESSION_PEPPER='unit-test-session-pepper';
process.env.INTEGRATION_ENCRYPTION_KEY='MDAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVm';

const { chunkText } = await import('../src/ai/knowledge.js');
const { smartFallback } = await import('../src/ai/fallback.js');
const { encryptJson, decryptJson } = await import('../src/security.js');

test('knowledge chunking preserves useful overlap and content', () => {
  const content = `${'Service information. '.repeat(90)}\n\n${'Booking policy. '.repeat(90)}`;
  const chunks = chunkText(content, { size: 500, overlap: 80 });
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((chunk) => chunk.length <= 500));
  assert.match(chunks.join(' '), /Booking policy/);
});

test('tenant integration secrets round-trip with authenticated encryption', () => {
  const payload = { accessToken: 'secret-token', locationId: 'location-1' };
  const encrypted = encryptJson(payload);
  assert.notEqual(encrypted, JSON.stringify(payload));
  assert.deepEqual(decryptJson(encrypted), payload);
});

test('grounded fallback answers from approved knowledge and cites it', async () => {
  const result = await smartFallback({
    message: 'What services do you provide?',
    chunks: [{ id: 'chunk-1', content: 'Services include drain cleaning, leak repair, and water heater replacement.' }],
    context: { client: { business_hours: {}, emergency_rules: [], timezone: 'America/Chicago' }, agent: {}, conversationId: null }
  });
  assert.equal(result.requiresHandoff, false);
  assert.match(result.text, /drain cleaning/i);
  assert.deepEqual(result.citations, ['chunk-1']);
});

test('grounded fallback refuses unsupported pricing', async () => {
  const result = await smartFallback({
    message: 'How much does a new furnace cost?',
    chunks: [{ id: 'chunk-1', content: 'We install and repair heating equipment.' }],
    context: { client: { business_hours: {}, emergency_rules: [], timezone: 'America/Chicago' }, agent: {}, conversationId: null }
  });
  assert.equal(result.requiresHandoff, true);
  assert.equal(result.intent, 'pricing');
  assert.match(result.text, /approved price/i);
});

test('emergency language always causes escalation', async () => {
  const result = await smartFallback({
    message: 'My basement has active flooding right now',
    chunks: [],
    context: { client: { business_hours: {}, emergency_rules: ['active flooding'], timezone: 'America/Chicago' }, agent: { handoff_number: '+15155550123' }, conversationId: null }
  });
  assert.equal(result.requiresHandoff, true);
  assert.equal(result.intent, 'emergency');
  assert.equal(result.confidence, 0.99);
});
