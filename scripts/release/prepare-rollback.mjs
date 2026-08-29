#!/usr/bin/env node

export function buildRollbackPlan(input) {
  const required = ["currentVersion", "rollbackVersion", "environment", "approver"];
  const missing = required.filter((name) => !input[name]);
  if (missing.length) throw new Error(`Missing rollback fields: ${missing.join(", ")}`);
  if (input.currentVersion === input.rollbackVersion) throw new Error("rollbackVersion must differ from currentVersion.");
  return {
    execute: false,
    environment: input.environment,
    currentVersion: input.currentVersion,
    rollbackVersion: input.rollbackVersion,
    approver: input.approver,
    steps: [
      "Open a controlled change window and notify stakeholders.",
      "Disable payment, email, and automation feature flags.",
      "Verify backup/restore evidence and migration compatibility.",
      "Have an authorized human redeploy rollbackVersion.",
      "Run post-deploy verification and attach evidence to the deployment record.",
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const plan = buildRollbackPlan(JSON.parse(process.argv[2] ?? "{}"));
    console.log(JSON.stringify(plan, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to prepare rollback plan.");
    process.exitCode = 1;
  }
}
