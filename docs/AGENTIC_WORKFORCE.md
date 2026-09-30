# UG Mall agentic workforce

UG Mall's governed business workers use the Codex CLI authenticated with the server's ChatGPT account. They do not use or require a separate model API key. A fourth WhatsApp care agent also runs continuously from signed Support Hub events.

## Workers

### Catalogue Manager

- Audits active and draft products for weak titles, descriptions, tags, SEO and image quality.
- Autonomously executes truthful catalogue, category, publishing, pricing, sale-window and featured-placement improvements.
- Can derive three useful formats from an existing product image: clean square, portrait and attention-based detail crop.
- Never generates an unseen angle, colour, logo, specification or product feature. The original image is retained.

### Campaign Manager

- Selects active products using catalogue, stock and historical order signals.
- Can create, update, activate, deactivate and delete storefront promotions.
- Campaign discounts are capped at 25% and a campaign cannot run for more than 31 days.

### Discount Manager

- Can create, update, activate, deactivate and delete percent, fixed-value or free-delivery coupons. Used coupons are deactivated instead of physically deleted so redemption history remains intact.
- Percent coupons are capped at 15%.
- A fixed coupon cannot exceed 15% of its minimum order value.
- Every coupon has an expiry, a total-use cap and a per-customer cap.

### WhatsApp Care Agent

- Uses the standalone WhatsApp Support Hub for transport, routing, history and delivery state.
- Helps customers track orders, cancel eligible orders and submit return requests.
- Escalates unrecognized questions and issues to the support console and the administrator.
- Sends the administrator new-order and failed-payment alerts.
- Sends every governed employee proposal to WhatsApp with **Approve** and **Reject** buttons.
- Accepts approval clicks only from the configured administrator number, which must also belong to an active staff account.
- Can audit communications workload in **Admin → AI Workforce**; its manual Codex review is observational and cannot execute changes.

## Governance and audit lifecycle

1. Workers run automatically on recurring schedules. Staff may also start an immediate focused run from **Admin → AI Workforce**.
2. The application creates a frozen input snapshot and SHA-256 hash before queueing the work.
3. Codex runs in an ephemeral, read-only sandbox with a stripped environment. The prompt contains business context but no database, payment, WhatsApp or server credentials.
4. Codex returns typed actions. Invalid or unsupported output is rejected.
5. The application independently revalidates IDs, dates, margins, discount limits and state before executing each action.
6. Valid actions execute automatically; failures are isolated to that action and recorded instead of stopping the whole run.
7. Before/after snapshots, timestamps and automatic-system audit entries remain available in Admin. The manual approval inbox remains available for legacy or explicitly approval-controlled actions.

The durable records are `agent_runs`, `agent_actions`, and the general `audit_log`. Idempotency keys prevent a proposal from being applied twice.

## Permissions

- `agents.view`: see worker runs, proposals and history.
- `agents.run`: start a worker analysis.
- `agents.approve`: approve, execute or reject proposed changes.
- The owner role (`*`) has all three automatically. Assign the permissions deliberately to other roles.

## Runtime and deployment

Codex runs in a small host-side service. The background worker can reach it
only through a Unix socket; the runner has no database or payment credentials.

- Host service definition: `deploy/ugmall-codex-runner.service`.
- Socket: `/opt/shop/agent-runtime/codex.sock` on the host and
  `/agent-runtime/codex.sock` in the worker container.
- Codex commands run with `--ephemeral --sandbox read-only`.
- Agent queue concurrency is one to keep server load and business changes predictable.

Before deployment, verify the host login with `codex login status`. The expected result is `Logged in using ChatGPT`.

## Automatic schedule

- Catalogue: every 24 hours.
- Campaigns: every 12 hours.
- Discounts: every 24 hours.
- Communications review: every 6 hours; live WhatsApp customer care remains event-driven and continuous.

The worker also queues a missing scheduled review at startup. Overlap checks prevent duplicate runs for the same role and interval.
