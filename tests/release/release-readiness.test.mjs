import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseEnvironment } from "../../scripts/release/validate-environment.mjs";
import { createDeploymentRecord } from "../../scripts/release/create-deployment-record.mjs";
import { verifyPostDeploy } from "../../scripts/release/post-deploy-verify.mjs";
import { buildRollbackPlan } from "../../scripts/release/prepare-rollback.mjs";

test("environment validation blocks enabled integrations without explicit approval metadata", () => {
  const result = validateReleaseEnvironment({
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_COMMIT_SHA: "abc1234",
    RELEASE_APPROVER: "",
    NEXT_PUBLIC_APP_URL: "https://staging.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-placeholder",
    FEATURE_PAYMENTS_ENABLED: "true",
    FEATURE_EMAIL_ENABLED: "false",
    FEATURE_AUTOMATION_ENABLED: "false",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("RELEASE_APPROVER is required when an external integration is enabled."));
  assert.ok(result.errors.every((error) => !error.includes("test-placeholder")));
});

test("deployment records cannot be created without rollback and human approval fields", () => {
  assert.throws(
    () => createDeploymentRecord({ commit: "abc1234", executor: "release-bot", tests: ["npm test"] }),
    /rollbackVersion, approver/,
  );
});

test("post-deploy verification fails when the real health endpoint is unhealthy", async () => {
  const result = await verifyPostDeploy("https://staging.example.test", async () =>
    new Response(JSON.stringify({ success: false }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    checks: [{ name: "health", ok: false, status: 503 }],
  });
});

test("rollback preparation refuses a no-op target", () => {
  assert.throws(
    () => buildRollbackPlan({ currentVersion: "abc1234", rollbackVersion: "abc1234", environment: "staging", approver: "human-owner" }),
    /must differ/,
  );
});
