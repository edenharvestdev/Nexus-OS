import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  PaymentWebhookGuard,
  createPaymentWebhookSignedMaterial,
  type PaymentWebhookInbox,
  type WebhookInboxBeginResult,
} from "../../src/server/integrations/payment-webhook.ts";

class MemoryWebhookInbox implements PaymentWebhookInbox {
  private readonly records = new Map<string, { state: "processing" | "completed"; leaseId: string }>();
  private leaseSequence = 0;

  async begin(provider: string, eventId: string): Promise<WebhookInboxBeginResult> {
    const key = `${provider}:${eventId}`;
    const record = this.records.get(key);
    if (record?.state === "completed") return { status: "completed" };
    if (record?.state === "processing") return { status: "in_progress" };

    const leaseId = `lease-${++this.leaseSequence}`;
    this.records.set(key, { state: "processing", leaseId });
    return { status: "acquired", leaseId };
  }

  async complete(provider: string, eventId: string, leaseId: string): Promise<void> {
    const key = `${provider}:${eventId}`;
    const record = this.records.get(key);
    assert.deepEqual(record, { state: "processing", leaseId });
    this.records.set(key, { state: "completed", leaseId });
  }

  async failRetryable(provider: string, eventId: string, leaseId: string): Promise<void> {
    const key = `${provider}:${eventId}`;
    assert.deepEqual(this.records.get(key), { state: "processing", leaseId });
    this.records.delete(key);
  }
}

const secret = "test-only-webhook-secret";
const body = JSON.stringify({ eventId: "evt-1", amountMinor: 12500, currency: "USD" });
const timestamp = "1787961600";
const config = { enabled: true, secret, maxAgeSeconds: 300 };
const now = () => new Date("2026-08-29T00:00:00.000Z");

function signedMaterial(provider: string, eventId: string, signedTimestamp: string, rawBody: string): string {
  return JSON.stringify(["nexus-payment-webhook-v1", provider, eventId, signedTimestamp, rawBody]);
}

function sign(provider: string, eventId: string, signedTimestamp = timestamp, rawBody = body): string {
  return createHmac("sha256", secret)
    .update(signedMaterial(provider, eventId, signedTimestamp, rawBody))
    .digest("hex");
}

function request(eventId = "evt-1") {
  return { provider: "sandbox", eventId, timestamp, signature: sign("sandbox", eventId), rawBody: body };
}

async function verify(guard: PaymentWebhookGuard, webhookRequest = request()) {
  return guard.verifyAndProcess(webhookRequest, config, async () => undefined);
}

test("defines canonical signed material for provider, event id, timestamp, and raw body", () => {
  assert.equal(
    createPaymentWebhookSignedMaterial(request()),
    signedMaterial("sandbox", "evt-1", timestamp, body),
  );
});

test("rejects changes to any identity or payload field covered by the signature", async () => {
  const signature = sign("sandbox", "evt-1");

  for (const webhookRequest of [
    { provider: "other", eventId: "evt-1", timestamp, signature, rawBody: body },
    { provider: "sandbox", eventId: "evt-2", timestamp, signature, rawBody: body },
    { provider: "sandbox", eventId: "evt-1", timestamp, signature, rawBody: `${body} ` },
  ]) {
    assert.deepEqual(await verify(new PaymentWebhookGuard(new MemoryWebhookInbox(), now), webhookRequest), {
      accepted: false,
      code: "INVALID_SIGNATURE",
    });
  }
});

test("rejects malformed, future, and stale webhook timestamps", async () => {
  const malformed = { provider: "sandbox", eventId: "evt-malformed", timestamp: "1787961600.5", rawBody: body };
  assert.deepEqual(
    await verify(new PaymentWebhookGuard(new MemoryWebhookInbox(), now), {
      ...malformed,
      signature: sign(malformed.provider, malformed.eventId, malformed.timestamp),
    }),
    { accepted: false, code: "INVALID_REQUEST" },
  );

  const futureTimestamp = "1787961601";
  assert.deepEqual(
    await verify(new PaymentWebhookGuard(new MemoryWebhookInbox(), now), {
      provider: "sandbox",
      eventId: "evt-future",
      timestamp: futureTimestamp,
      signature: sign("sandbox", "evt-future", futureTimestamp),
      rawBody: body,
    }),
    { accepted: false, code: "FUTURE_TIMESTAMP" },
  );

  const staleTimestamp = "1787961299";
  assert.deepEqual(
    await verify(new PaymentWebhookGuard(new MemoryWebhookInbox(), now), {
      provider: "sandbox",
      eventId: "evt-stale",
      timestamp: staleTimestamp,
      signature: sign("sandbox", "evt-stale", staleTimestamp),
      rawBody: body,
    }),
    { accepted: false, code: "STALE_TIMESTAMP" },
  );
});

test("rejects invalid maxAgeSeconds configuration", async () => {
  for (const maxAgeSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const guard = new PaymentWebhookGuard(new MemoryWebhookInbox(), now);
    assert.deepEqual(
      await guard.verifyAndProcess(request("evt-config"), { ...config, maxAgeSeconds }, async () => undefined),
      { accepted: false, code: "INVALID_CONFIG" },
    );
  }
});

test("releases the durable inbox lease so a transient processing failure can be retried", async () => {
  const guard = new PaymentWebhookGuard(new MemoryWebhookInbox(), now);
  let attempts = 0;

  await assert.rejects(
    guard.verifyAndProcess(request("evt-retry"), config, async () => {
      attempts += 1;
      throw new Error("transient provider outage");
    }),
    /transient provider outage/,
  );

  assert.deepEqual(
    await guard.verifyAndProcess(request("evt-retry"), config, async () => {
      attempts += 1;
    }),
    { accepted: true },
  );
  assert.equal(attempts, 2);
});

test("completes the inbox record and rejects every replay without reprocessing", async () => {
  const guard = new PaymentWebhookGuard(new MemoryWebhookInbox(), now);
  let processed = 0;

  assert.deepEqual(
    await guard.verifyAndProcess(request("evt-complete"), config, async () => {
      processed += 1;
    }),
    { accepted: true },
  );
  assert.deepEqual(
    await guard.verifyAndProcess(request("evt-complete"), config, async () => {
      processed += 1;
    }),
    { accepted: false, code: "REPLAYED_EVENT" },
  );
  assert.equal(processed, 1);
});

test("payment webhook processing is fail-closed while the feature flag is off", async () => {
  const guard = new PaymentWebhookGuard(new MemoryWebhookInbox(), now);
  assert.deepEqual(
    await guard.verifyAndProcess(
      { provider: "sandbox", eventId: "evt-2", timestamp, signature: "invalid", rawBody: body },
      { enabled: false, maxAgeSeconds: 300 },
      async () => undefined,
    ),
    { accepted: false, code: "DISABLED" },
  );
});
