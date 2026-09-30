# UG Mall agentic workforce

UG Mall's first three AI workers use the Codex CLI authenticated with the server's ChatGPT account. They do not use or require a separate model API key.

## Workers

### Catalogue Manager

- Audits active and draft products for weak titles, descriptions, tags, SEO and image quality.
- Can propose truthful catalogue edits and mark products as featured/trending.
- Can derive three useful formats from an existing product image: clean square, portrait and attention-based detail crop.
- Never generates an unseen angle, colour, logo, specification or product feature. The original image is retained.

### Campaign Manager

- Selects active products using catalogue, stock and historical order signals.
- Can propose and create a time-boxed storefront promotion.
- Campaign discounts are capped at 25% and a campaign cannot run for more than 31 days.

### Discount Manager

- Can propose and create percent, fixed-value or free-delivery coupons.
- Percent coupons are capped at 15%.
- A fixed coupon cannot exceed 15% of its minimum order value.
- Every coupon has an expiry, a total-use cap and a per-customer cap.

## Governance and audit lifecycle

1. A staff member starts a worker run from **Admin → AI Workforce** and may add a short objective.
2. The application creates a frozen input snapshot and SHA-256 hash before queueing the work.
3. Codex runs in an ephemeral, read-only sandbox with a stripped environment. The prompt contains business context but no database, payment, WhatsApp or server credentials.
4. Codex returns structured proposals. Invalid or unsupported output is rejected.
5. Every proposal enters `awaiting_approval`; Codex cannot write to the shop database.
6. A staff member with `agents.approve` reviews the exact payload and chooses **Approve & execute** or **Reject**.
7. The application revalidates business limits, executes the typed action and stores before/after snapshots, actor IDs and timestamps.

The durable records are `agent_runs`, `agent_actions`, and the general `audit_log`. Idempotency keys prevent a proposal from being applied twice.

## Permissions

- `agents.view`: see worker runs, proposals and history.
- `agents.run`: start a worker analysis.
- `agents.approve`: approve, execute or reject proposed changes.
- The owner role (`*`) has all three automatically. Assign the permissions deliberately to other roles.

## Runtime and deployment

The background worker container mounts the host's Codex installation and login:

- `CODEX_INSTALL_ROOT` defaults to `/usr/lib/node_modules/@openai/codex`.
- `CODEX_HOME_HOST` defaults to `/home/ubuntu/.codex`.
- Agent queue concurrency is one to keep server load and business changes predictable.

Before deployment, verify the host login with `codex login status`. The expected result is `Logged in using ChatGPT`.

## Initial operating policy

All actions require a human approval. After the audit history demonstrates reliable behaviour, individually low-risk actions can be considered for automatic execution. Discount creation and campaign publication should remain approval-controlled.
