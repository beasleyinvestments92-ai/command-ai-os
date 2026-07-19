# Provider Setup

## OpenAI

Set:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_STORE=false
```

Add accurate input/output token rates for margin reporting. Deploy, add approved knowledge, run `npm run test:live-ai`, review every output, then disable simulation mode in Settings. Keep the API key server-side.

## Twilio inbound SMS

Configure the phone number's incoming message webhook as:

```text
POST https://YOUR-DOMAIN/webhooks/twilio/sms?agent=AGENT_ID
```

## Twilio inbound voice

Configure the phone number's incoming call webhook as:

```text
POST https://YOUR-DOMAIN/webhooks/twilio/voice?agent=AGENT_ID
```

Set `TWILIO_VALIDATE_WEBHOOKS=true` in production. The `agent` query parameter prevents a multi-client installation from routing a number to the wrong business. Test STOP/opt-out handling, empty speech, normal questions, emergencies, transfer, and after-hours behavior before advertising the number.

The speech flow uses Twilio Gather and is appropriate for an initial release. For a low-latency, full-duplex voice experience, build a separate media-stream service and retain the same grounded orchestrator and tool layer.

## Stripe

Create one recurring Price for each plan and set its Price ID:

```env
STRIPE_PRICE_RECEPTIONIST=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_OPERATOR=price_...
STRIPE_PRICE_MULTI_LOCATION=price_...
```

Register:

```text
POST https://YOUR-DOMAIN/webhooks/stripe
```

Subscribe at minimum to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the endpoint signing secret to `STRIPE_WEBHOOK_SECRET`. Use Stripe test mode through the full checkout, portal, renewal, failed-payment, and cancellation flow before switching to live mode.

## HighLevel

From Settings → Integrations, encrypt and store a private integration access token, location ID, and optional calendar ID for the tenant. Test the connection before enabling appointment sync.

For a product distributed to unrelated agencies, replace private-token installation with HighLevel OAuth, refresh-token rotation, scopes limited to required resources, and installation/uninstallation lifecycle handling.

Optional inbound event endpoint:

```text
POST https://YOUR-DOMAIN/webhooks/highlevel
X-Command-Webhook-Secret: configured-secret
```

HighLevel sync failures do not erase a locally confirmed appointment. The appointment metadata records the sync warning for operator follow-up.
