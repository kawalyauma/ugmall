# WhatsApp Support Hub and Care Agent

UG Mall uses the standalone **WhatsApp Support Hub v11** as its WhatsApp provider. The Hub owns Meta credentials, application routing, centralized conversations, media and delivery receipts. UG Mall owns commerce workflows and stores no duplicate support transcript.

## Hub application setup

Create a Hub application named **UG Mall** and configure:

- Webhook URL: `https://<API_DOMAIN>/api/webhooks/whatsapp-support`
- A long random webhook secret
- Webhook enabled
- Approved order notification templates listed in `docs/whatsapp-templates.md`

Enter these values under **Admin → Settings → WhatsApp Support Hub**. Secret
values are encrypted at rest and never returned to the browser after saving.
These API and worker environment variables remain available as fallbacks:

```env
WHATSAPP_SUPPORT_HUB_URL=https://whatsapp-support-hub.ulib5000.workers.dev
WHATSAPP_SUPPORT_APP_KEY=<UG Mall application API key>
WHATSAPP_SUPPORT_WEBHOOK_SECRET=<same secret configured on the Hub application>
WHATSAPP_ADMIN_NUMBER=2567XXXXXXXX
WHATSAPP_USE_TEMPLATES=true
WHATSAPP_TEMPLATE_LANGUAGE=en
```

The administrator number must match the `phone` of an active UG Mall staff user. Without that second identity check, interactive approval clicks are refused.

## Automated flows

- New order: customer confirmation plus an operational summary to the administrator.
- Failed payment/underpayment: customer recovery message plus an administrator alert.
- Agent proposal: administrator receives the title, explanation and risk with **Approve** / **Reject** buttons.
- Customer support: every inbound customer message is answered automatically. The menu covers live product discovery, stock and budget searches, orders, delivery, payments, shop details, returns and human support.
- Shopping: natural-language requests such as `black shoes under 80k` are matched against the live catalogue and return current prices, stock signals and storefront links.
- Order management: latest-order lookup, live status, balance and safe cancellation where the state machine permits it.
- Returns: a delivered order can generate a return request. The administrator receives **Approve** / **Reject** buttons. Approval does not issue money or mark goods received; inspection and refund remain separate controlled steps.
- Conversation lifecycle: explicit completion (`thanks`, `done`, `bye`), a completed cancellation, or a submitted return sends a final reply with the Hub's `closeConversation` instruction. A later message is reopened by the Hub. Ambiguous, sensitive and human-requested cases stay open and are escalated with context.
- Other issues: the customer receives an immediate acknowledgement or a guided retry, with a human-support option. Human requests are escalated to the Hub support console and administrator.

All Hub webhook events are HMAC-verified from the exact raw body before being queued. Outbound workflow messages use Hub idempotency keys. Approval execution still uses the existing row locks, validation, audit log and before/after snapshots.

## Deployment check

After saving the Hub settings, both `api` and `worker` pick them up without a restart. Confirm the worker starts the `whatsapp-care` queue. Test with a non-production order, a failed payment, a return request and a low-risk agent proposal before relying on live alerts.
