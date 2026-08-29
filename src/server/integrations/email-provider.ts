export type EmailMessage = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
};

export interface EmailProvider {
  /** Provider adapters must forward idempotencyKey when supported. */
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export type EmailFeatureConfig = { enabled: boolean };

export type EmailDeliveryResult =
  | { delivered: true; providerMessageId: string }
  | { delivered: false; code: "DISABLED" | "INVALID_MESSAGE" | "PROVIDER_FAILURE" };

export class EmailDeliveryGateway {
  private readonly provider: EmailProvider;
  private readonly config: EmailFeatureConfig;

  constructor(provider: EmailProvider, config: EmailFeatureConfig) {
    this.provider = provider;
    this.config = config;
  }

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    if (!this.config.enabled) return { delivered: false, code: "DISABLED" };
    if (!message.idempotencyKey || !message.to.includes("@") || !message.subject.trim() || !message.text.trim()) {
      return { delivered: false, code: "INVALID_MESSAGE" };
    }
    try {
      const result = await this.provider.send(message);
      return { delivered: true, providerMessageId: result.providerMessageId };
    } catch {
      return { delivered: false, code: "PROVIDER_FAILURE" };
    }
  }
}
