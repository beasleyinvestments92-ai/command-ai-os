# Release Checklist

A paying-customer release is approved only when every required item is complete.

## Platform

- [ ] Production HTTPS URL is stable and configured as `APP_URL`
- [ ] Managed PostgreSQL is private, encrypted, backed up, and restore-tested
- [ ] Independent production secrets are stored in the host secret manager
- [ ] Bootstrap password has been rotated and removed from environment configuration
- [ ] `/healthz` and `/readyz` are monitored
- [ ] CI passes for the exact deployed commit
- [ ] Error logs and uptime alerts reach an operator
- [ ] Rate limits match expected traffic; shared limiting is added before multi-instance scale

## AI quality

- [ ] OpenAI live evaluation passes
- [ ] Simulation mode is disabled only for tested tenants
- [ ] Every live agent has reviewed approved knowledge
- [ ] Pricing answers never exceed approved language
- [ ] Unknown facts create a safe handoff
- [ ] Prompt injection and private-data tests refuse correctly
- [ ] Emergency phrases escalate immediately
- [ ] Booking claims occur only after tool confirmation
- [ ] Conversation memory does not duplicate the current customer turn
- [ ] Usage cost rates are current

## Channels

- [ ] Widget origins are explicitly restricted
- [ ] Twilio number is mapped to the correct agent ID
- [ ] Twilio webhook validation is enabled
- [ ] SMS STOP/opt-out was tested
- [ ] Voice disclosure and transfer were tested
- [ ] Stripe test-mode lifecycle passed
- [ ] Stripe live webhook signature verified
- [ ] HighLevel contact and appointment sync tested, or clearly disabled

## Security and governance

- [ ] Privacy policy, terms, acceptable-use policy, and AI/call disclosure are published
- [ ] Data retention and deletion procedures are documented
- [ ] Support and security contact channels are monitored
- [ ] Staff access is least privilege and reviewed
- [ ] MFA/SSO is enabled before multiple operators or sensitive workloads
- [ ] Vendor agreements and regional consent requirements are reviewed
- [ ] Incident response and customer notification procedures are assigned
- [ ] No real secrets, card data, passwords, SSNs, or unnecessary sensitive data are present in knowledge or test conversations

## Commercial

- [ ] Plans, setup fees, included usage, overages, support boundaries, and cancellation terms are explicit
- [ ] Client approves knowledge, greeting, escalation rules, and service claims
- [ ] Refund, failed-payment, and cancellation behavior is tested
- [ ] A human can take over every live channel
- [ ] First clients are launched gradually with daily response review
