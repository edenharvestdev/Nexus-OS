import assert from "node:assert/strict";
import test from "node:test";

import { EmailDeliveryGateway, type EmailProvider } from "../../src/server/integrations/email-provider.ts";

test("email delivery remains disabled by default and never calls the provider", async () => {
  let calls = 0;
  const provider: EmailProvider = {
    async send() {
      calls += 1;
      return { providerMessageId: "should-not-exist" };
    },
  };
  const gateway = new EmailDeliveryGateway(provider, { enabled: false });

  const result = await gateway.send({
    idempotencyKey: "invitation:client-1",
    to: "client@example.test",
    subject: "Invitation",
    text: "Accept your invitation.",
  });

  assert.deepEqual(result, { delivered: false, code: "DISABLED" });
  assert.equal(calls, 0);
});
