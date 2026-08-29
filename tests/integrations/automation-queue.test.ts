import assert from "node:assert/strict";
import test from "node:test";

import { AutomationQueue, type DurableAutomationJobStore } from "../../src/server/integrations/automation-queue.ts";

test("automation enqueue is disabled by default and makes no durable write", async () => {
  let writes = 0;
  const store: DurableAutomationJobStore = {
    async enqueue() {
      writes += 1;
      return { jobId: "job-1" };
    },
    async claimDue() {
      throw new Error("not used");
    },
    async complete() {},
    async fail() {},
  };
  const queue = new AutomationQueue(store, { enabled: false });

  assert.deepEqual(
    await queue.enqueue({ tenantId: "tenant-a", type: "invoice.created", payload: { invoiceId: "invoice-1" }, idempotencyKey: "invoice-1:created" }),
    { enqueued: false, code: "DISABLED" },
  );
  assert.equal(writes, 0);
});
