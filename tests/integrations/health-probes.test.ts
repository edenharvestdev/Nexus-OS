import assert from "node:assert/strict";
import test from "node:test";

import { probeHttpService, runHealthProbes } from "../../src/server/integrations/health-probes.ts";

test("health reports distinguish configured services from successful probes", async () => {
  const report = await runHealthProbes([
    { name: "email", configured: true, probe: async () => ({ healthy: false, message: "provider timeout" }) },
    { name: "payments", configured: false, probe: async () => ({ healthy: true, message: "must not run" }) },
  ]);

  assert.deepEqual(
    report.services.map(({ name, configured, status }) => ({ name, configured, status })),
    [
      { name: "email", configured: true, status: "unhealthy" },
      { name: "payments", configured: false, status: "not_configured" },
    ],
  );
  assert.equal(report.overallStatus, "unhealthy");
});

test("HTTP probes report authentication failures as unhealthy instead of configured", async () => {
  const result = await probeHttpService("https://service.example.test/health", {}, async () =>
    new Response("unauthorized", { status: 401 }),
  );

  assert.deepEqual(result, { healthy: false, message: "Probe returned HTTP 401." });
});
