import { DateTime } from 'luxon';
import { one, many, tx, query } from '../db/index.js';
import { id } from '../utils/ids.js';
import { cleanText, normalizeEmail, normalizePhone } from '../utils/text.js';
import { upsertHighLevelContact, createHighLevelAppointment, getHighLevelConfigSummary } from '../integrations/highlevel.js';

const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

export const toolDefinitions = [
  {
    type: 'function', name: 'check_availability', strict: true,
    description: 'Check real appointment availability before offering times to the customer.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      start_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      days: { type: 'integer', minimum: 1, maximum: 14 },
      service: { type: 'string' }
    }, required: ['start_date','days','service'] }
  },
  {
    type: 'function', name: 'book_appointment', strict: true,
    description: 'Book an appointment only after the customer has supplied required contact details and agreed to an available time.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      start_at: { type: 'string', description: 'ISO 8601 datetime including timezone offset' },
      full_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
      service: { type: 'string' }, service_address: { type: 'string' }, notes: { type: 'string' }
    }, required: ['start_at','full_name','phone','email','service','service_address','notes'] }
  },
  {
    type: 'function', name: 'request_human_handoff', strict: true,
    description: 'Escalate an emergency, customer request for a human, low-confidence answer, complaint, or sensitive matter.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      reason: { type: 'string' }, priority: { type: 'string', enum: ['normal','urgent','emergency'] }
    }, required: ['reason','priority'] }
  },
  {
    type: 'function', name: 'capture_contact', strict: true,
    description: 'Save or update contact details and the reason for inquiry.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      full_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, inquiry: { type: 'string' }, consent_to_contact: { type: 'boolean' }
    }, required: ['full_name','phone','email','inquiry','consent_to_contact'] }
  }
];

async function getContext(context) {
  const client = await one('SELECT * FROM clients WHERE id=$1 AND tenant_id=$2', [context.clientId, context.tenantId]);
  if (!client) throw new Error('Client not found.');
  return client;
}

function withinHours(client, start, durationMinutes) {
  const local = start.setZone(client.timezone || 'America/Chicago');
  const window = client.business_hours?.[dayNames[local.weekday % 7]];
  if (!Array.isArray(window) || window.length < 2) return false;
  const [openHour, openMinute] = window[0].split(':').map(Number);
  const [closeHour, closeMinute] = window[1].split(':').map(Number);
  const open = local.startOf('day').set({ hour: openHour, minute: openMinute });
  const close = local.startOf('day').set({ hour: closeHour, minute: closeMinute });
  return local >= open && local.plus({ minutes: durationMinutes }) <= close;
}

async function checkAvailability(context, args) {
  const client = await getContext(context);
  const settings = context.tenantSettings || {};
  const duration = Number(settings.appointmentDurationMinutes || 30);
  const buffer = Number(settings.appointmentBufferMinutes || 15);
  const timezone = client.timezone || 'America/Chicago';
  let cursor = DateTime.fromISO(args.start_date, { zone: timezone }).startOf('day');
  if (!cursor.isValid) cursor = DateTime.now().setZone(timezone).startOf('day');
  const end = cursor.plus({ days: Math.min(Number(args.days || 7), 14) });
  const existing = await many(`SELECT start_at,end_at FROM appointments WHERE client_id=$1 AND status IN ('confirmed','pending') AND start_at<$2 AND end_at>$3`, [client.id, end.toUTC().toISO(), cursor.toUTC().toISO()]);
  const slots = [];
  while (cursor < end && slots.length < 8) {
    const window = client.business_hours?.[dayNames[cursor.weekday % 7]];
    if (Array.isArray(window) && window.length >= 2) {
      const [openHour, openMinute] = window[0].split(':').map(Number);
      const [closeHour, closeMinute] = window[1].split(':').map(Number);
      let slot = cursor.set({ hour: openHour, minute: openMinute });
      const close = cursor.set({ hour: closeHour, minute: closeMinute });
      while (slot.plus({ minutes: duration }) <= close && slots.length < 8) {
        const slotEnd = slot.plus({ minutes: duration });
        const conflict = existing.some((item) => {
          const start = DateTime.fromJSDate(new Date(item.start_at));
          const finish = DateTime.fromJSDate(new Date(item.end_at));
          return slot.toUTC() < finish.plus({ minutes: buffer }) && slotEnd.toUTC().plus({ minutes: buffer }) > start;
        });
        if (!conflict && slot > DateTime.now().setZone(timezone).plus({ hours: 2 })) {
          slots.push({ start_at: slot.toISO(), end_at: slotEnd.toISO(), display: slot.toFormat("ccc, LLL d 'at' h:mm a ZZZZ") });
        }
        slot = slot.plus({ minutes: duration + buffer });
      }
    }
    cursor = cursor.plus({ days: 1 });
  }
  return { available: slots.length > 0, timezone, service: cleanText(args.service, 120), slots };
}

async function upsertContact(client, context, args) {
  const phone = normalizePhone(args.phone);
  const email = normalizeEmail(args.email);
  let contact = phone ? await client.query('SELECT * FROM contacts WHERE client_id=$1 AND phone=$2 LIMIT 1', [context.clientId, phone]).then((r) => r.rows[0]) : null;
  if (!contact && email) contact = await client.query('SELECT * FROM contacts WHERE client_id=$1 AND email=$2 LIMIT 1', [context.clientId, email]).then((r) => r.rows[0]);
  const consent = { contact: Boolean(args.consent_to_contact), capturedAt: new Date().toISOString(), source: context.channel || 'Web Chat' };
  if (contact) {
    return client.query(`UPDATE contacts SET name=COALESCE(NULLIF($1,''),name),phone=COALESCE(NULLIF($2,''),phone),email=COALESCE(NULLIF($3,''),email),consent=$4,metadata=metadata || $5::jsonb,updated_at=now() WHERE id=$6 RETURNING *`, [cleanText(args.full_name, 120), phone, email, JSON.stringify(consent), JSON.stringify({ inquiry: cleanText(args.inquiry, 500) }), contact.id]).then((r) => r.rows[0]);
  }
  return client.query(`INSERT INTO contacts(id,tenant_id,client_id,name,phone,email,consent,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [id('contact'), context.tenantId, context.clientId, cleanText(args.full_name, 120), phone || null, email || null, JSON.stringify(consent), JSON.stringify({ inquiry: cleanText(args.inquiry, 500) })]).then((r) => r.rows[0]);
}

async function bookAppointment(context, args) {
  const clientRecord = await getContext(context);
  const settings = context.tenantSettings || {};
  const duration = Number(settings.appointmentDurationMinutes || 30);
  const start = DateTime.fromISO(args.start_at, { setZone: true });
  if (!start.isValid) return { booked: false, error: 'The requested appointment time is invalid.' };
  if (start < DateTime.now().plus({ hours: 1 })) return { booked: false, error: 'The requested appointment time is too soon or in the past.' };
  if (!withinHours(clientRecord, start, duration)) return { booked: false, error: 'That time is outside business hours.' };
  const local = await tx(async (client) => {
    const end = start.plus({ minutes: duration });
    const conflict = await client.query(`SELECT id FROM appointments WHERE client_id=$1 AND status IN ('confirmed','pending') AND start_at<$2 AND end_at>$3 LIMIT 1 FOR UPDATE`, [context.clientId, end.toUTC().toISO(), start.toUTC().toISO()]);
    if (conflict.rows.length) return { booked: false, error: 'That time was just taken. Please choose another available time.' };
    const contact = await upsertContact(client, context, { ...args, inquiry: args.service, consent_to_contact: true });
    const appointment = await client.query(`INSERT INTO appointments(id,tenant_id,client_id,conversation_id,contact_id,start_at,end_at,status,service,notes,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10) RETURNING *`, [
      id('appt'), context.tenantId, context.clientId, context.conversationId || null, contact.id, start.toUTC().toISO(), end.toUTC().toISO(), cleanText(args.service, 160), cleanText(`${args.notes}
Service address: ${args.service_address}`, 1000), JSON.stringify({ source: context.channel })
    ]).then((r) => r.rows[0]);
    await client.query('UPDATE clients SET appointments_count=appointments_count+1,updated_at=now() WHERE id=$1', [context.clientId]);
    await client.query('UPDATE agents SET bookings=bookings+1,updated_at=now() WHERE id=$1', [context.agentId]);
    return { booked: true, appointment, contact, display: start.setZone(clientRecord.timezone).toFormat("cccc, LLLL d 'at' h:mm a ZZZZ") };
  });
  if (!local.booked) return local;
  let crmSync = { attempted: false, synced: false, reason: 'HighLevel is not configured.' };
  const highLevel = await getHighLevelConfigSummary(context.tenantId);
  if (highLevel.configured) {
    try {
      crmSync.attempted = true;
      const highLevelContact = await upsertHighLevelContact(context.tenantId, { name: local.contact.name, email: local.contact.email, phone: local.contact.phone, source: 'COMMAND AI booking' });
      const externalContactId = highLevelContact?.contact?.id || highLevelContact?.id;
      if (externalContactId) await query('UPDATE contacts SET external_id=$1,updated_at=now() WHERE id=$2', [externalContactId, local.contact.id]);
      const highLevelAppointment = await createHighLevelAppointment(context.tenantId, {
        contactId: externalContactId, startAt: local.appointment.start_at, endAt: local.appointment.end_at,
        title: local.appointment.service || 'Service appointment', status: 'confirmed', notes: local.appointment.notes
      });
      const externalAppointmentId = highLevelAppointment?.calendar?.id || highLevelAppointment?.id;
      if (externalAppointmentId) await query('UPDATE appointments SET external_id=$1,metadata=metadata || $2::jsonb,updated_at=now() WHERE id=$3', [externalAppointmentId, JSON.stringify({ highLevelSynced: true }), local.appointment.id]);
      crmSync = { attempted: true, synced: true, contactId: externalContactId || null, appointmentId: externalAppointmentId || null };
    } catch (error) {
      crmSync = { attempted: true, synced: false, warning: cleanText(error.message, 500) };
      await query('UPDATE appointments SET metadata=metadata || $1::jsonb,updated_at=now() WHERE id=$2', [JSON.stringify({ highLevelSyncError: crmSync.warning }), local.appointment.id]);
    }
  }
  return { booked: true, appointment: { id: local.appointment.id, start_at: start.toISO(), end_at: start.plus({ minutes: duration }).toISO(), display: local.display, service: local.appointment.service }, contactId: local.contact.id, crmSync };
}

async function requestHandoff(context, args) {
  if (!context.conversationId) return { requested: true, priority: args.priority, reason: cleanText(args.reason, 500), note: 'Test mode handoff was not persisted because there is no live conversation.' };
  const existing = await one(`SELECT * FROM handoffs WHERE conversation_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`, [context.conversationId]);
  const handoff = existing || await one(`INSERT INTO handoffs(id,tenant_id,conversation_id,reason,priority) VALUES($1,$2,$3,$4,$5) RETURNING *`, [id('handoff'), context.tenantId, context.conversationId, cleanText(args.reason, 500), args.priority]);
  await query(`UPDATE conversations SET requires_handoff=true,handoff_reason=$1,updated_at=now() WHERE id=$2`, [cleanText(args.reason, 500), context.conversationId]);
  return { requested: true, priority: handoff.priority, reason: handoff.reason, handoffNumber: context.agent?.handoff_number || null };
}

export async function executeTool(name, args, context) {
  switch (name) {
    case 'check_availability': return checkAvailability(context, args);
    case 'book_appointment': return bookAppointment(context, args);
    case 'request_human_handoff': return requestHandoff(context, args);
    case 'capture_contact': {
      const contact = await tx((client) => upsertContact(client, context, args));
      const highLevel = await getHighLevelConfigSummary(context.tenantId);
      if (!highLevel.configured) return { captured: true, contactId: contact.id, crmSynced: false, crmAttempted: false };
      try {
        const external = await upsertHighLevelContact(context.tenantId, { name: contact.name, email: contact.email, phone: contact.phone, source: 'COMMAND AI lead capture' });
        const externalId = external?.contact?.id || external?.id || null;
        if (externalId) await query('UPDATE contacts SET external_id=$1,updated_at=now() WHERE id=$2', [externalId, contact.id]);
        return { captured: true, contactId: contact.id, crmSynced: Boolean(externalId), crmAttempted: true, externalId };
      } catch (error) {
        return { captured: true, contactId: contact.id, crmSynced: false, crmAttempted: true, warning: cleanText(error.message, 500) };
      }
    }
    default: return { error: `Unknown tool: ${name}` };
  }
}
