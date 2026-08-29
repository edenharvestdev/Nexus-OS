import assert from "node:assert/strict";
import test from "node:test";

import { readIntegrationFeatureFlags } from "../../src/server/integrations/feature-flags.ts";

test("all external integration feature flags default to off", () => {
  assert.deepEqual(readIntegrationFeatureFlags({}), {
    payments: false,
    email: false,
    automation: false,
  });
});
