import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { decryptJson, encryptJson } from '../security.js';
import { id } from '../utils/ids.js';

async function tenantConfig(tenantId) {
  const row = await one(`SELECT * FROM integrations WHERE tenant_id=$1 AND provider='highlevel'`, [tenantId]);
  const stored = row?.encrypted_config ? decryptJson(row.encrypted_config) : {};
  return {
    accessToken: stored?.accessToken || config.highLevel.accessToken,
    locationId: stored?.locationId || config.highLevel.locationId,
    calendarId: stored?.calendarId || config.highLevel.calendarId,
    apiVersion: stored?.apiVersion || config.highLevel.apiVersion,
    status: row?.status || (config.highLevel.accessToken ? 'configured' : 'disconnected')
  };
}

async function request(tenantId, pathname, options = {}) {
  const auth = await tenantConfig(tenantId);
  if (!auth.accessToken) throw new Error('HighLevel access token is not configured.');
  const response = await fetch(`${config.highLevel.baseURL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Version: auth.apiVersion,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`HighLevel request failed (${response.status}): ${text.slice(0, 500)}`);
  return body;
}

export async function saveHighLevelConfig(tenantId, value) {
  const encrypted = encryptJson({
    accessToken: value.accessToken,
    locationId: value.locationId,
    calendarId: value.calendarId,
    apiVersion: value.apiVersion || config.highLevel.apiVersion
  });
  return one(`INSERT INTO integrations(id,tenant_id,provider,status,encrypted_config,metadata)
    VALUES($1,$2,'highlevel','configured',$3,$4)
    ON CONFLICT(tenant_id,provider) DO UPDATE SET status='configured',encrypted_config=EXCLUDED.encrypted_config,metadata=EXCLUDED.metadata,updated_at=now()
    RETURNING id,provider,status,metadata,updated_at`, [id('integration'), tenantId, encrypted, JSON.stringify({ locationId: value.locationId, calendarId: value.calendarId || '' })]);
}

export async function testHighLevel(tenantId) {
  const auth = await tenantConfig(tenantId);
  if (!auth.accessToken || !auth.locationId) return { connected: false, message: 'HighLevel token and location ID are required.' };
  const result = await request(tenantId, `/locations/${encodeURIComponent(auth.locationId)}`);
  await query(`INSERT INTO integrations(id,tenant_id,provider,status,metadata) VALUES($1,$2,'highlevel','connected',$3)
    ON CONFLICT(tenant_id,provider) DO UPDATE SET status='connected',metadata=integrations.metadata || EXCLUDED.metadata,updated_at=now()`, [id('integration'), tenantId, JSON.stringify({ testedAt: new Date().toISOString() })]);
  return { connected: true, location: result.location || result };
}

export async function upsertHighLevelContact(tenantId, contact) {
  const auth = await tenantConfig(tenantId);
  if (!auth.locationId) throw new Error('HighLevel location ID is not configured.');
  return request(tenantId, '/contacts/upsert', {
    method: 'POST', body: JSON.stringify({
      locationId: auth.locationId, name: contact.name, email: contact.email || undefined, phone: contact.phone || undefined,
      source: contact.source || 'COMMAND AI'
    })
  });
}

export async function createHighLevelAppointment(tenantId, appointment) {
  const auth = await tenantConfig(tenantId);
  if (!auth.calendarId) throw new Error('HighLevel calendar ID is not configured.');
  return request(tenantId, '/calendars/events/appointments', {
    method: 'POST', body: JSON.stringify({
      calendarId: auth.calendarId,
      locationId: auth.locationId,
      contactId: appointment.contactId,
      startTime: appointment.startAt,
      endTime: appointment.endAt,
      title: appointment.title,
      appointmentStatus: appointment.status || 'confirmed',
      notes: appointment.notes || ''
    })
  });
}

export async function getHighLevelConfigSummary(tenantId) {
  const auth = await tenantConfig(tenantId);
  return { configured: Boolean(auth.accessToken && auth.locationId), locationId: auth.locationId || '', calendarId: auth.calendarId || '', status: auth.status };
}
