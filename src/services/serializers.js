import { many, one } from '../db/index.js';
import { config } from '../config.js';

export function prospect(row) {
  return {
    id: row.id, businessName: row.business_name, industry: row.industry, city: row.city || '', website: row.website || '',
    phone: row.phone || '', email: row.email || '', status: row.status, score: row.score === null ? null : Number(row.score),
    estimatedMissedRevenue: row.estimated_missed_revenue === null ? null : Number(row.estimated_missed_revenue), audit: row.audit,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function client(row) {
  return {
    id: row.id, businessName: row.business_name, industry: row.industry, plan: row.plan, monthlyPrice: Number(row.monthly_price || 0),
    status: row.status, launchProgress: row.launch_progress, phone: row.phone || '', email: row.email || '', website: row.website || '',
    timezone: row.timezone, businessHours: row.business_hours || {}, emergencyRules: row.emergency_rules || [],
    integrationStatus: row.integration_status || {}, externalIds: row.external_ids || {},
    appointments: row.appointments_count || 0, recoveredLeads: row.recovered_leads_count || 0,
    monthlyUsage: Number(row.monthly_usage_cost || 0), subscriptionStatus: row.subscription_status || 'not_configured',
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function agent(row) {
  return {
    id: row.id, clientId: row.client_id, name: row.name, role: row.role, status: row.status, model: row.model,
    tone: row.tone, objective: row.objective, guardrails: row.guardrails, greeting: row.greeting,
    handoffNumber: row.handoff_number || '', channels: row.channels || [], widgetToken: row.widget_token,
    settings: row.settings || {}, callsHandled: row.calls_handled || 0, bookings: row.bookings || 0,
    conversionRate: Number(row.conversion_rate || 0), promptVersion: row.prompt_version, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export async function conversation(row) {
  const messages = await many('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC', [row.id]);
  const contact = row.contact_id ? await one('SELECT * FROM contacts WHERE id=$1', [row.contact_id]) : null;
  return {
    id: row.id, clientId: row.client_id, agentId: row.agent_id, contactId: row.contact_id,
    contactName: contact?.name || row.metadata?.contactName || 'Website visitor', channel: row.channel,
    status: row.status, sentiment: row.sentiment, summary: row.summary || '', requiresHandoff: row.requires_handoff,
    handoffReason: row.handoff_reason || '', updatedAt: row.updated_at, createdAt: row.created_at,
    messages: messages.map((message) => ({ id: message.id, from: message.role === 'assistant' || message.role === 'agent' ? 'agent' : 'contact', role: message.role, text: message.content, metadata: message.metadata || {}, at: message.created_at }))
  };
}

export async function dashboard(tenantId, tenant) {
  const [clients, agents, prospects, conversations, appointments, handoffs, usage, activity] = await Promise.all([
    many('SELECT * FROM clients WHERE tenant_id=$1', [tenantId]),
    many('SELECT * FROM agents WHERE tenant_id=$1', [tenantId]),
    many('SELECT * FROM prospects WHERE tenant_id=$1', [tenantId]),
    many('SELECT * FROM conversations WHERE tenant_id=$1', [tenantId]),
    one(`SELECT count(*)::int AS total FROM appointments WHERE tenant_id=$1 AND start_at >= date_trunc('month',now())`, [tenantId]),
    one(`SELECT count(*)::int AS total FROM handoffs WHERE tenant_id=$1 AND status='open'`, [tenantId]),
    one(`SELECT COALESCE(sum(cost_usd),0) AS total FROM usage_events WHERE tenant_id=$1 AND created_at >= date_trunc('month',now())`, [tenantId]),
    many('SELECT * FROM audit_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tenantId])
  ]);
  const recurringRevenue = clients.filter((item) => item.status !== 'Cancelled').reduce((sum, item) => sum + Number(item.monthly_price || 0), 0);
  const aiCost = Number(usage?.total || 0) || clients.reduce((sum, item) => sum + Number(item.monthly_usage_cost || 0), 0);
  const liveClients = clients.filter((item) => item.status === 'Live').length;
  const leadsRecovered = clients.reduce((sum, item) => sum + Number(item.recovered_leads_count || 0), 0);
  return {
    brand: tenant.brand,
    metrics: {
      recurringRevenue, activeClients: liveClients, appointments: appointments?.total || 0, leadsRecovered,
      openConversations: conversations.filter((item) => item.status === 'Open').length,
      openHandoffs: handoffs?.total || 0, aiCost: Number(aiCost.toFixed(4)),
      grossMargin: recurringRevenue ? Number((((recurringRevenue - aiCost) / recurringRevenue) * 100).toFixed(1)) : 0,
      automationRate: conversations.length ? Number(((conversations.filter((item) => !item.requires_handoff).length / conversations.length) * 100).toFixed(1)) : 0
    },
    activity: activity.map((item) => ({ id: item.id, type: item.entity_type || 'system', text: item.action.replaceAll('.', ' '), at: item.created_at })),
    topAgents: agents.sort((a,b) => b.bookings-a.bookings).slice(0,4).map(agent),
    onboarding: clients.filter((item) => item.status === 'Onboarding').map(client),
    integrationStatus: {
      openAI: Boolean(config.openai.apiKey), highLevel: Boolean(config.highLevel.accessToken), twilio: Boolean(config.twilio.authToken), stripe: Boolean(config.stripe.secretKey),
      database: true, simulationMode: Boolean(tenant.settings?.simulationMode) || !config.openai.apiKey
    }
  };
}
