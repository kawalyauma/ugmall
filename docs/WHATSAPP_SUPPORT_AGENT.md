# WhatsApp Support Hub and Care Agent

UG Mall uses the standalone **WhatsApp Support Hub v11** as its WhatsApp provider. The Hub owns Meta credentials, application routing, centralized conversations, media and delivery receipts. UG Mall owns commerce workflows and keeps an application-scoped assistant history and rolling memory so follow-up messages survive worker restarts. The Hub remains the authoritative transport transcript.

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
- Natural conversation: Amina can answer general-knowledge questions and retain recent conversation context; live shop facts always come from governed application tools rather than model guesses.
- Shopping: natural-language requests such as `black shoes under 80k` are matched against the live catalogue and return current prices, descriptions, attributes, variant availability and storefront links.
- Assisted checkout: an explicit instruction such as `order Samsung A06, deliver to Ntinda opposite UNEB, send the MoMo prompt to 0772...` can search the catalogue and location tree, create an idempotent WhatsApp order and initiate payment. Missing or ambiguous information is requested before any order is placed.
- Order management: latest-order lookup, live status, balance and safe cancellation where the state machine permits it.
- Payment reconciliation: reports such as `I paid but it still shows unpaid` trigger an authoritative provider status check before the assistant answers; a fresh prompt can be sent only for the customer's own awaiting-payment order.
- Administrator conversation: the verified administrator number can request today's dashboard, named reports, open/escalated conversation summaries, and resolve a selected customer case. Customer-only and administrator-only tools are enforced in application code.
- Returns: a delivered order can generate a return request. The administrator receives **Approve** / **Reject** buttons. Approval does not issue money or mark goods received; inspection and refund remain separate controlled steps.
- Conversation lifecycle: explicit completion (`thanks`, `done`, `bye`), a completed cancellation, or a submitted return sends a final reply with the Hub's `closeConversation` instruction. A later message is reopened by the Hub. Ambiguous, sensitive and human-requested cases stay open and are escalated with context.
- Other issues: the customer receives an immediate acknowledgement or a guided retry, with a human-support option. Human requests are escalated to the Hub support console and administrator.

Assistant memory is stored in `assistant_conversations` and `assistant_messages`. It deliberately excludes payment PINs, passwords and card data. Mutating tools are authorization-checked by the application; the language model never receives direct database or provider credentials.

All Hub webhook events are HMAC-verified from the exact raw body before being queued. Outbound workflow messages use Hub idempotency keys. Approval execution still uses the existing row locks, validation, audit log and before/after snapshots.

## Deployment check

After saving the Hub settings, both `api` and `worker` pick them up without a restart. Confirm the worker starts the `whatsapp-care` queue. Test with a non-production order, a failed payment, a return request and a low-risk agent proposal before relying on live alerts.
