import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookReplayStore {
  /** Atomically persist a unique (provider,eventId) claim. Must be durable. */
  claim(provider: string, eventId: string): Promise<boolean>;
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
  | { accepted: false; code: "DISABLED" | "NOT_CONFIGURED" | "STALE_TIMESTAMP" | "INVALID_SIGNATURE" | "REPLAYED_EVENT" | "INVALID_REQUEST" };

export class PaymentWebhookGuard {
  private readonly replayStore: WebhookReplayStore;
  private readonly now: () => Date;

  constructor(replayStore: WebhookReplayStore, now: () => Date = () => new Date()) {
    this.replayStore = replayStore;
    this.now = now;
  }

  async verifyAndClaim(request: PaymentWebhookRequest, config: PaymentWebhookConfig): Promise<PaymentWebhookDecision> {
    if (!config.enabled) return { accepted: false, code: "DISABLED" };
    if (!config.secret) return { accepted: false, code: "NOT_CONFIGURED" };
    if (!request.provider || !request.eventId || !/^\d+$/.test(request.timestamp) || !/^[a-f\d]{64}$/i.test(request.signature)) {
      return { accepted: false, code: "INVALID_REQUEST" };
    }

    const ageSeconds = Math.abs(this.now().getTime() / 1000 - Number(request.timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > config.maxAgeSeconds) {
      return { accepted: false, code: "STALE_TIMESTAMP" };
    }

    const expected = createHmac("sha256", config.secret)
      .update(`${request.timestamp}.${request.rawBody}`)
      .digest();
    const supplied = Buffer.from(request.signature, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return { accepted: false, code: "INVALID_SIGNATURE" };
    }

    if (!(await this.replayStore.claim(request.provider, request.eventId))) {
      return { accepted: false, code: "REPLAYED_EVENT" };
    }
    return { accepted: true };
  }
}
