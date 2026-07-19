import Stripe from 'stripe';
import { config } from '../config.js';
import { one, query } from '../db/index.js';

let stripe;
function client() {
  if (!config.stripe.secretKey) throw new Error('Stripe is not configured.');
  if (!stripe) stripe = new Stripe(config.stripe.secretKey);
  return stripe;
}

export function stripeConfigured() {
  return Boolean(config.stripe.secretKey);
}

export async function createClientCheckout({ tenantId, clientId, plan }) {
  const record = await one('SELECT * FROM clients WHERE id=$1 AND tenant_id=$2', [clientId, tenantId]);
  if (!record) throw new Error('Client not found.');
  const price = config.stripe.prices[plan || record.plan];
  if (!price) throw new Error(`Stripe price is not configured for ${plan || record.plan}.`);
  let customerId = record.stripe_customer_id;
  if (!customerId) {
    const customer = await client().customers.create({ name: record.business_name, email: record.email || undefined, phone: record.phone || undefined, metadata: { tenantId, clientId } });
    customerId = customer.id;
    await query('UPDATE clients SET stripe_customer_id=$1 WHERE id=$2', [customerId, clientId]);
  }
  const session = await client().checkout.sessions.create({
    mode: 'subscription', customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${config.appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/?billing=cancelled`,
    client_reference_id: clientId,
    metadata: { tenantId, clientId, plan: plan || record.plan },
    subscription_data: { metadata: { tenantId, clientId, plan: plan || record.plan } },
    allow_promotion_codes: true
  });
  return { url: session.url, id: session.id };
}

export async function createClientPortal({ tenantId, clientId }) {
  const record = await one('SELECT * FROM clients WHERE id=$1 AND tenant_id=$2', [clientId, tenantId]);
  if (!record?.stripe_customer_id) throw new Error('This client does not have a Stripe customer yet.');
  const session = await client().billingPortal.sessions.create({ customer: record.stripe_customer_id, return_url: `${config.appUrl}/#/billing` });
  return { url: session.url };
}

export function constructStripeEvent(rawBody, signature) {
  if (!config.stripe.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  return client().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

export async function processStripeEvent(event) {
  const object = event.data.object;
  let clientId = object.metadata?.clientId || object.client_reference_id || object.subscription_details?.metadata?.clientId || object.parent?.subscription_details?.metadata?.clientId || object.lines?.data?.find((line) => line.metadata?.clientId)?.metadata?.clientId;
  if (!clientId && object.subscription) clientId = (await one('SELECT id FROM clients WHERE stripe_subscription_id=$1 LIMIT 1', [typeof object.subscription === 'string' ? object.subscription : object.subscription.id]))?.id;
  if (!clientId && object.customer) clientId = (await one('SELECT id FROM clients WHERE stripe_customer_id=$1 LIMIT 1', [typeof object.customer === 'string' ? object.customer : object.customer.id]))?.id;
  if (!clientId) return { ignored: true, reason: 'No client mapping found.' };
  switch (event.type) {
    case 'checkout.session.completed':
      await query(`UPDATE clients SET stripe_customer_id=$1,stripe_subscription_id=$2,subscription_status='active',updated_at=now() WHERE id=$3`, [object.customer, object.subscription, clientId]);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await query(`UPDATE clients SET stripe_subscription_id=$1,subscription_status=$2,updated_at=now() WHERE id=$3`, [object.id, object.status, clientId]);
      break;
    case 'customer.subscription.deleted':
      await query(`UPDATE clients SET subscription_status='cancelled',status='Cancelled',updated_at=now() WHERE id=$1`, [clientId]);
      break;
    case 'invoice.payment_failed':
      await query(`UPDATE clients SET subscription_status='past_due',updated_at=now() WHERE id=$1`, [clientId]);
      break;
    case 'invoice.paid':
      await query(`UPDATE clients SET subscription_status='active',updated_at=now() WHERE id=$1`, [clientId]);
      break;
    default:
      return { ignored: true };
  }
  return { processed: true, clientId };
}
