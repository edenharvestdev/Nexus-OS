import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { PaymentWebhookGuard, type WebhookReplayStore } from "../../src/server/integrations/payment-webhook.ts";

class MemoryReplayStore implements WebhookReplayStore {
  private readonly keys = new Set<string>();
  async claim(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}

const secret = "test-only-webhook-secret";
const body = JSON.stringify({ eventId: "evt-1", amountMinor: 12500, currency: "USD" });
const timestamp = "1787961600";
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

test("verifies payment webhook authenticity and atomically rejects replayed event ids", async () => {
  const guard = new PaymentWebhookGuard(new MemoryReplayStore(), () => new Date("2026-08-29T00:00:00.000Z"));
  const request = { provider: "sandbox", eventId: "evt-1", timestamp, signature, rawBody: body };
  const config = { enabled: true, secret, maxAgeSeconds: 300 };

  assert.deepEqual(await guard.verifyAndClaim(request, config), { accepted: true });
  assert.deepEqual(await guard.verifyAndClaim(request, config), {
    accepted: false,
    code: "REPLAYED_EVENT",
  });
});

test("payment webhook processing is fail-closed while the feature flag is off", async () => {
  const guard = new PaymentWebhookGuard(new MemoryReplayStore(), () => new Date("2026-08-29T00:00:00.000Z"));
  assert.deepEqual(
    await guard.verifyAndClaim(
      { provider: "sandbox", eventId: "evt-2", timestamp, signature: "invalid", rawBody: body },
      { enabled: false, maxAgeSeconds: 300 },
    ),
    { accepted: false, code: "DISABLED" },
  );
});
