import { fileURLToPath } from 'node:url';
import { config, validateConfig } from '../src/config.js';
import { one, query, closePool } from '../src/db/index.js';
import { hashPassword } from '../src/security.js';
import { id, token } from '../src/utils/ids.js';
import { slugify } from '../src/utils/text.js';

export async function seed() {
  if (!config.adminEmail || !config.adminPassword) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set; skipping administrator seed.');
    return;
  }
  if (config.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

  let tenant = await one('SELECT * FROM tenants WHERE slug=$1', [config.defaultTenantSlug]);
  if (!tenant) {
    const tenantId = id('tenant');
    const brand = {
      name: config.defaultTenantName,
      tagline: 'AI front office for local businesses',
      accent: '#4f8cff',
      supportEmail: config.adminEmail,
      domain: config.appUrl,
      logoMark: config.defaultTenantName.split(/\s+/).map((word) => word[0]).join('').slice(0, 3).toUpperCase()
    };
    const settings = {
      timezone: 'America/Chicago',
      simulationMode: !config.openai.apiKey,
      defaultPlan: 'Growth',
      requireHumanApprovalForOutbound: true,
      recordingDisclosureEnabled: true,
      dataRetentionDays: 365,
      appointmentDurationMinutes: 30,
      appointmentBufferMinutes: 15
    };
    tenant = await one(`INSERT INTO tenants(id,name,slug,brand,settings) VALUES($1,$2,$3,$4,$5) RETURNING *`, [tenantId, config.defaultTenantName, slugify(config.defaultTenantSlug), JSON.stringify(brand), JSON.stringify(settings)]);
  }

  let user = await one('SELECT * FROM users WHERE email=$1', [config.adminEmail]);
  if (!user) {
    user = await one(`INSERT INTO users(id,email,password_hash,full_name,platform_role) VALUES($1,$2,$3,$4,'platform_admin') RETURNING *`, [id('user'), config.adminEmail, await hashPassword(config.adminPassword), config.adminName]);
  }
  await query(`INSERT INTO memberships(user_id,tenant_id,role) VALUES($1,$2,'owner') ON CONFLICT(user_id,tenant_id) DO UPDATE SET role='owner'`, [user.id, tenant.id]);

  const existingClient = await one('SELECT id FROM clients WHERE tenant_id=$1 LIMIT 1', [tenant.id]);
  if (!existingClient) {
    const clientId = id('client');
    await query(`INSERT INTO clients(id,tenant_id,business_name,industry,plan,monthly_price,status,launch_progress,phone,email,timezone,business_hours,emergency_rules)
                 VALUES($1,$2,$3,$4,'Growth',497,'Live',100,$5,$6,'America/Chicago',$7,$8)`, [
      clientId, tenant.id, 'Demo Home Services', 'Plumbing & HVAC', '+15155550123', 'demo@example.com',
      JSON.stringify({ monday: ['07:00','18:00'], tuesday: ['07:00','18:00'], wednesday: ['07:00','18:00'], thursday: ['07:00','18:00'], friday: ['07:00','18:00'], saturday: ['08:00','14:00'] }),
      JSON.stringify(['active flooding', 'gas odor', 'sewage backup', 'no heat below freezing'])
    ]);
    const agentId = id('agent');
    await query(`INSERT INTO agents(id,tenant_id,client_id,name,role,status,model,tone,objective,guardrails,greeting,handoff_number,channels,widget_token,settings)
                 VALUES($1,$2,$3,'Atlas','24/7 AI Receptionist','Active',$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      agentId, tenant.id, clientId, config.openai.model,
      'Professional, calm, efficient, and natural. Use plain language.',
      'Answer questions from approved knowledge, capture qualified leads, book valid appointments, and escalate urgent or uncertain matters.',
      'Never invent pricing, availability, policies, credentials, completed actions, or personal information. Use tools before claiming a booking. Escalate emergencies and low-confidence answers.',
      'Thank you for calling Demo Home Services. I am Atlas, the virtual receptionist. How can I help?',
      '+15155550123', JSON.stringify(['Voice','SMS','Web Chat']), token(24), JSON.stringify({ minimumConfidence: 0.7, allowBooking: true, allowHandoff: true })
    ]);
    const content = `Demo Home Services serves residential customers in the Des Moines metro.\n\nHours: Monday through Friday 7:00 AM to 6:00 PM; Saturday 8:00 AM to 2:00 PM; closed Sunday.\n\nServices: drain cleaning, leak repair, water heater service, furnace repair, air conditioner repair, fixture installation, and sewer inspections.\n\nPricing: Do not quote a final price before diagnosis. A technician provides an estimate after evaluating the issue.\n\nEmergencies: Active flooding, sewage backup, gas odor, or no heat during freezing temperatures requires immediate human escalation.\n\nBooking: Collect full name, phone number, service address, service needed, and preferred time. Never promise an appointment until the booking tool confirms it.`;
    const documentId = id('doc');
    await query(`INSERT INTO knowledge_documents(id,tenant_id,client_id,agent_id,title,source_type,content,checksum) VALUES($1,$2,$3,$4,'Core business knowledge','text',$5,$6)`, [documentId, tenant.id, clientId, agentId, content, (await import('../src/utils/text.js')).checksum(content)]);
    await query(`INSERT INTO knowledge_chunks(id,tenant_id,client_id,document_id,chunk_index,content,token_count) VALUES($1,$2,$3,$4,0,$5,$6)`, [id('chunk'), tenant.id, clientId, documentId, content, Math.ceil(content.length / 4)]);
  }

  console.log(`Seed complete for ${config.adminEmail}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateConfig();
  seed().then(() => closePool()).catch(async (error) => {
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });
}
