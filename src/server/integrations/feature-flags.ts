export type IntegrationFeatureFlags = {
  payments: boolean;
  email: boolean;
  automation: boolean;
};

export function readIntegrationFeatureFlags(env: Record<string, string | undefined> = process.env): IntegrationFeatureFlags {
  return {
    payments: env.FEATURE_PAYMENTS_ENABLED === "true",
    email: env.FEATURE_EMAIL_ENABLED === "true",
    automation: env.FEATURE_AUTOMATION_ENABLED === "true",
  };
}
