# WhatsApp message templates

Order notifications are business-initiated, so outside the 24-hour customer
service window they must use templates approved in WhatsApp Manager.
Create these templates (category **Utility**, language `en`) with exactly these
body variables. Plain-text versions (used when `WHATSAPP_USE_TEMPLATES=false`)
are in `packages/notifications/src/messages.ts`.

| Template name | Body |
|---|---|
| `order_received` | Hello {{1}}, thank you for your order {{2}}. Total: {{3}}. Payment: {{4}}. Track it here: {{5}} |
| `payment_confirmed` | Hello {{1}}, we have received your payment of {{2}} for order {{3}}. We are preparing it now. |
| `order_confirmed` | Hello {{1}}, your order {{2}} is confirmed and being prepared. Track it: {{3}} |
| `rider_dispatched` | Hello {{1}}, your order {{2}} is on the way with {{3}}. Amount to pay on delivery: {{4}}. |
| `order_delivered` | Hello {{1}}, your order {{2}} has been delivered. Thank you for shopping with us! |
| `order_cancelled` | Hello {{1}}, your order {{2}} has been cancelled. Reason: {{3}}. Reply if you need help. |
| `payment_failed` | Hello {{1}}, we could not complete the Mobile Money payment for order {{2}}. Try again: {{3}} |
| `refund_sent` | Hello {{1}}, we have refunded {{2}} for order {{3}}. |
| `login_code` (Authentication) | {{1}} is your verification code. |

## Webhook
Configure the webhook in the Meta app dashboard:

- Callback URL: `https://<SHOP_DOMAIN>/api/webhooks/whatsapp`
- Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
- Subscribe to `messages`. Inbound messages are stored and shown on the customer's page in the admin.
- Set `WHATSAPP_APP_SECRET` so payloads are signature-checked.
