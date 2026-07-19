# Operator Runbook

## Daily

- Review open human handoffs before routine inbox messages.
- Inspect low-confidence and uncited responses.
- Confirm booked appointments reached the selected CRM/calendar.
- Review failed webhooks and provider errors.
- Review AI usage cost and gross margin by client.
- Add or correct knowledge when customers expose an answer gap.
- Confirm no client is live with a draft or untested agent.

## Before launching a client

1. Verify legal business name, public phone, website, timezone, and service area.
2. Enter explicit business hours for each working day.
3. Enter concrete emergency phrases and escalation destinations.
4. Add approved services, pricing rules, booking requirements, cancellation policy, warranty boundaries, and prohibited claims.
5. Set the handoff number and confirm it can accept transfers.
6. Run the test suite: hours, services, pricing, booking, emergency, complaint, request for a human, prompt injection, private data, and an unknown question.
7. Restrict widget origins to the client's real web domains.
8. Test the production widget and every connected channel.
9. Obtain client approval of the knowledge and scripts.
10. Activate the agent only after the release-readiness panel is acceptable.

## Knowledge quality rules

- Write one authoritative fact once; remove contradictory copies.
- Use exact hours, geographic boundaries, and policy conditions.
- Clearly distinguish estimates from final prices.
- State what requires diagnosis or human approval.
- Do not upload secrets, employee personal information, customer lists, card data, or unnecessary regulated data.
- Re-test affected questions after every material document change.

## Incident priorities

- Emergency: safety risk, data exposure, unauthorized provider use, cross-tenant data access, or payment compromise. Disable affected agents/integrations immediately.
- Urgent: widespread incorrect answers, failed transfers, failed bookings, or webhook outage.
- Normal: isolated knowledge gap, delayed sync, styling, or reporting defect.

Preserve relevant audit logs, webhook IDs, conversation IDs, timestamps, release SHA, and provider request IDs. Never paste secrets into tickets or chat.
