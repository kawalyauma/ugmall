# Commerce integrations

UG Mall is the source of truth for products, stock, orders, delivery, returns and customer communication preferences. Ledgerly is the source of truth for posted accounting. The two applications connect over Ledgerly's scoped API; they do not share a database.

## Ledgerly accounting

The PostgreSQL `accounting_outbox` table is populated by database triggers in the same transaction as an order becoming paid/delivered or a refund becoming succeeded. A worker claims and retries these rows. Ledgerly journal creation uses a stable `Idempotency-Key`; posting is retried against the same journal ID. The outbox records the posted journal ID and keeps errors for operational review. Transient failures retry with exponential backoff; after 20 attempts, the row enters `failed` for operator review.

Create a Ledgerly API key scoped only to `journals:write` in the UG Mall organization. Keep the key in the production secret store, never in Git. Configure all `LEDGERLY_*` variables from `.env.example`. Account mappings are Ledgerly account IDs:

| Setting | Journal use |
| --- | --- |
| `LEDGERLY_CLEARING_ACCOUNT_ID` | Debit for receipts; credit for refunds. Use the settlement/clearing asset account for mobile money, card and cash collections. |
| `LEDGERLY_SALES_REVENUE_ACCOUNT_ID` | Credit for the order's product subtotal before discounts. |
| `LEDGERLY_DELIVERY_REVENUE_ACCOUNT_ID` | Credit for delivery fees when non-zero. |
| `LEDGERLY_SALES_DISCOUNTS_ACCOUNT_ID` | Debit for order discounts when non-zero. |
| `LEDGERLY_COGS_ACCOUNT_ID` | Debit for the order's recorded cost of goods. |
| `LEDGERLY_INVENTORY_ACCOUNT_ID` | Credit for inventory cost relieved on sale. |
| `LEDGERLY_RETURNS_ACCOUNT_ID` | Debit for successfully completed customer refunds. |

All mapped accounts must be active, postable, belong to the UG Mall organization, and support UGX. Ledgerly enforces fiscal-period locks and journal balancing. The accounting integration does not yet post tax lines because UG Mall orders do not currently store an explicit tax breakdown. Returned stock cost adjustments also need to be added when return receiving is represented as a separate accounting event.

Only paid prepaid orders and delivered cash-on-delivery orders are recognized as sales. Orders still awaiting payment are not posted. Refunds are posted when their payment/refund record reaches `succeeded`. Historical orders are not backfilled automatically; an operator should review any desired opening/backfill process before enabling the integration.

## Transactional email

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to enable Resend. Order lifecycle messages are sent only to a buyer email captured on the order. They use concise inline UG Mall templates and a stable provider idempotency key. The notification worker owns retries and the `notification_log` records delivery status. These messages are operational order updates, not marketing subscriptions.

## WhatsApp

UG Mall already supports the WhatsApp Support Hub with app-scoped credentials and approved template names. Configure its URL, app key and webhook secret in the secret store. Keep template sending enabled for business-initiated messages outside the customer-service window. No message is sent until the configured provider is available; the development provider only writes to its local log.

Use the existing `order_received`, `payment_confirmed`, `order_confirmed`, `rider_dispatched`, `delivered`, `cancelled` and `refund_sent` templates or provide approved templates with those names and compatible body parameters. Template language is controlled by `WHATSAPP_TEMPLATE_LANGUAGE`.

## Release checklist

1. Run the database migration before starting the worker.
2. Configure the UG Mall Ledgerly organization, account mappings and least-privilege API key.
3. Configure Resend's verified sender domain and production API key.
4. Configure the WhatsApp Support Hub app and approved templates.
5. Confirm secrets are present on the API/worker hosts, and check worker logs plus the `accounting_outbox` and `notification_log` tables after a controlled transaction.
6. Reconcile sample UGX journal entries in Ledgerly before enabling live checkout.
