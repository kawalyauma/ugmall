import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { customers, paymentEvents, payments, refunds, whatsappMessages } from "@ugmall/database";
import { PaymentError } from "@ugmall/payments";
import { parseWhatsAppWebhook, verifyWhatsAppSignature } from "@ugmall/notifications";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";

export const webhookRoutes = new Hono<AppEnv>();

/**
 * Payment provider callbacks. The provider tells us *that* something
 * happened; the provider class re-verifies with the provider's API before we
 * trust it, and the orders module applies the result idempotently.
 * Always answer 200 quickly for authentic callbacks so providers stop retrying.
 */
webhookRoutes.on(["POST", "GET"], "/payments/:provider", async (c) => {
  const { payments: registry, orders, db } = c.get("container");
  const providerId = c.req.param("provider");
  let provider;
  try {
    provider = registry.byProviderId(providerId);
  } catch {
    return c.json({ ok: false }, 404);
  }
  const rawBody = c.req.method === "POST" ? await c.req.text() : "";
  let parsed: unknown = rawBody;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = Object.fromEntries(new URLSearchParams(rawBody));
  }
  try {
    const result = await provider.handleWebhook({
      headers: Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])),
      query: c.req.query(),
      body: parsed,
      rawBody,
    });
    const [payment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.externalReference, result.externalReference));
    await db.insert(paymentEvents).values({ paymentId: payment?.id ?? null, provider: providerId, kind: "callback", payload: { body: parsed as object, verified: result.verified.status } });
    if (result.kind === "refund") {
      if (result.verified.status !== "pending") {
        await db
          .update(refunds)
          .set({ status: result.verified.status, completedAt: new Date() })
          .where(eq(refunds.externalReference, result.externalReference));
      }
    } else if (result.verified.status !== "pending") {
      await orders.applyPaymentResult(result.externalReference, result.verified);
    }
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof PaymentError && err.code === "BAD_SIGNATURE") {
      logger.warn({ providerId, ip: c.req.header("x-real-ip") }, "payment webhook with bad signature");
      return c.json({ ok: false }, 401);
    }
    logger.error({ err, providerId }, "payment webhook failed");
    return c.json({ ok: false }, 500); // provider will retry; poller also covers it
  }
});

/* ------------------------------------------------------------- WhatsApp */

webhookRoutes.get("/whatsapp", (c) => {
  const { env } = c.get("container");
  if (c.req.query("hub.mode") === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && c.req.query("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(c.req.query("hub.challenge") ?? "");
  }
  return c.text("forbidden", 403);
});

webhookRoutes.post("/whatsapp", async (c) => {
  const { env, db } = c.get("container");
  const raw = await c.req.text();
  if (env.WHATSAPP_APP_SECRET && !verifyWhatsAppSignature(env.WHATSAPP_APP_SECRET, raw, c.req.header("x-hub-signature-256"))) {
    return c.text("bad signature", 401);
  }
  const { messages, statuses } = parseWhatsAppWebhook(JSON.parse(raw || "{}"));
  for (const m of messages) {
    const [cust] = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, m.from));
    await db
      .insert(whatsappMessages)
      .values({ direction: "inbound", waMessageId: m.id, phone: m.from, customerId: cust?.id, body: m.text ?? `[${m.type}]`, payload: m as object })
      .onConflictDoNothing();
  }
  for (const s of statuses) {
    await db.update(whatsappMessages).set({ status: s.status }).where(eq(whatsappMessages.waMessageId, s.id));
  }
  return c.json({ ok: true });
});
