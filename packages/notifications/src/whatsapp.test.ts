import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppSupportHubProvider, verifySupportHubSignature } from "./whatsapp";

describe("WhatsAppSupportHubProvider", () => {
  it("sends app-scoped text through the Hub with idempotency", async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: { message: { externalMessageId: "wamid.1" } } }), { status: 201, headers: { "content-type": "application/json" } }));
    const provider = new WhatsAppSupportHubProvider({ baseUrl: "https://hub.example/", apiKey: "app-secret-key", fetch: request as typeof fetch });

    await expect(provider.sendText("256700000001", "Hello", { idempotencyKey: "msg-1" })).resolves.toEqual({ messageId: "wamid.1" });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://hub.example/v1/integrations/messages/send");
    expect((init as RequestInit).headers).toMatchObject({ "X-API-Key": "app-secret-key", "Idempotency-Key": "msg-1" });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ phoneNumber: "256700000001", type: "text", message: "Hello", reopenClosed: true });
  });

  it("sends interactive approval buttons", async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: { message: { external_message_id: "wamid.2" } } }), { status: 201 }));
    const provider = new WhatsAppSupportHubProvider({ baseUrl: "https://hub.example", apiKey: "app-secret-key", fetch: request as typeof fetch });
    await provider.sendButtons("256700000001", "Approve this?", [{ id: "ug:approve:1", title: "Approve" }, { id: "ug:reject:1", title: "Reject" }]);
    const payload = JSON.parse(String((request.mock.calls[0]![1] as RequestInit).body));
    expect(payload).toMatchObject({ type: "buttons", body: "Approve this?" });
    expect(payload.buttons).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ug:approve:1" }), expect.objectContaining({ id: "ug:reject:1" })]));
  });

  it("asks the Hub to close a resolved conversation after the final reply", async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    const provider = new WhatsAppSupportHubProvider({ baseUrl: "https://hub.example", apiKey: "app-secret-key", fetch: request as typeof fetch });
    await provider.sendText("256700000001", "Resolved", { idempotencyKey: "resolved-1", closeConversationId: "conversation-42" });
    const payload = JSON.parse(String((request.mock.calls[0]![1] as RequestInit).body));
    expect(payload).toMatchObject({
      phoneNumber: "256700000001",
      message: "Resolved",
      conversationId: "conversation-42",
      closeConversation: true,
    });
  });
});

describe("verifySupportHubSignature", () => {
  it("accepts only the correct raw-body HMAC", () => {
    const body = JSON.stringify({ event: "message.received" });
    const header = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
    expect(verifySupportHubSignature("webhook-secret", body, header)).toBe(true);
    expect(verifySupportHubSignature("webhook-secret", `${body} `, header)).toBe(false);
  });
});
