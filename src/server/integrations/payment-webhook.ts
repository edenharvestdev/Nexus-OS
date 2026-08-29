import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookInboxBeginResult =
  | { status: "acquired"; leaseId: string }
  | { status: "in_progress" }
  | { status: "completed" };

/**
 * Durable inbox port. Implementations must atomically acquire leases in begin,
 * fence complete/failRetryable by leaseId, and retain completed records.
 * Expired-lease recovery and persistence belong to the adapter; none is enabled here.
 */
export interface PaymentWebhookInbox {
  begin(provider: string, eventId: string): Promise<WebhookInboxBeginResult>;
  complete(provider: string, eventId: string, leaseId: string): Promise<void>;
  failRetryable(provider: string, eventId: string, leaseId: string): Promise<void>;
}

export type PaymentWebhookRequest = {
  provider: string;
  eventId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
};

export type PaymentWebhookConfig = {
  enabled: boolean;
  secret?: string;
  maxAgeSeconds: number;
};

export type PaymentWebhookDecision =
  | { accepted: true }
  | {
      accepted: false;
      code:
        | "DISABLED"
        | "NOT_CONFIGURED"
        | "INVALID_CONFIG"
        | "FUTURE_TIMESTAMP"
        | "STALE_TIMESTAMP"
        | "INVALID_SIGNATURE"
        | "REPLAYED_EVENT"
        | "INVALID_REQUEST";
    };

export function createPaymentWebhookSignedMaterial(request: Pick<PaymentWebhookRequest, "provider" | "eventId" | "timestamp" | "rawBody">): string {
  return JSON.stringify([
    "nexus-payment-webhook-v1",
    request.provider,
    request.eventId,
    request.timestamp,
    request.rawBody,
  ]);
}

export class PaymentWebhookGuard {
  private readonly inbox: PaymentWebhookInbox;
  private readonly now: () => Date;

  constructor(inbox: PaymentWebhookInbox, now: () => Date = () => new Date()) {
    this.inbox = inbox;
    this.now = now;
  }

  async verifyAndProcess(
    request: PaymentWebhookRequest,
    config: PaymentWebhookConfig,
    process: () => Promise<void>,
  ): Promise<PaymentWebhookDecision> {
    const rejection = this.verifyRequest(request, config);
    if (rejection) return rejection;

    const lease = await this.inbox.begin(request.provider, request.eventId);
    if (lease.status !== "acquired") {
      return { accepted: false, code: "REPLAYED_EVENT" };
    }

    try {
      await process();
    } catch (processingError) {
      try {
        await this.inbox.failRetryable(request.provider, request.eventId, lease.leaseId);
      } catch (inboxError) {
        throw new AggregateError(
          [processingError, inboxError],
          "Webhook processing failed and its inbox lease could not be released",
        );
      }
      throw processingError;
    }

    await this.inbox.complete(request.provider, request.eventId, lease.leaseId);
    return { accepted: true };
  }

  private verifyRequest(
    request: PaymentWebhookRequest,
    config: PaymentWebhookConfig,
  ): Exclude<PaymentWebhookDecision, { accepted: true }> | null {
    if (!config.enabled) return { accepted: false, code: "DISABLED" };
    if (!config.secret) return { accepted: false, code: "NOT_CONFIGURED" };
    if (!Number.isSafeInteger(config.maxAgeSeconds) || config.maxAgeSeconds <= 0) {
      return { accepted: false, code: "INVALID_CONFIG" };
    }
    if (
      !request.provider ||
      !request.eventId ||
      typeof request.rawBody !== "string" ||
      !/^\d+$/.test(request.timestamp) ||
      !/^[a-f\d]{64}$/i.test(request.signature)
    ) {
      return { accepted: false, code: "INVALID_REQUEST" };
    }

    const timestampSeconds = Number(request.timestamp);
    if (!Number.isSafeInteger(timestampSeconds)) {
      return { accepted: false, code: "INVALID_REQUEST" };
    }
    const ageSeconds = this.now().getTime() / 1000 - timestampSeconds;
    if (ageSeconds < 0) {
      return { accepted: false, code: "FUTURE_TIMESTAMP" };
    }
    if (!Number.isFinite(ageSeconds) || ageSeconds > config.maxAgeSeconds) {
      return { accepted: false, code: "STALE_TIMESTAMP" };
    }

    const expected = createHmac("sha256", config.secret)
      .update(createPaymentWebhookSignedMaterial(request))
      .digest();
    const supplied = Buffer.from(request.signature, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return { accepted: false, code: "INVALID_SIGNATURE" };
    }
    return null;
  }
}
