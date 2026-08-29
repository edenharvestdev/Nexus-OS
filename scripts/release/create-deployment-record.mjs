#!/usr/bin/env node

const REQUIRED = ["commit", "executor", "tests", "dbImpact", "rollbackVersion", "approver", "environment"];

export function createDeploymentRecord(input, now = () => new Date()) {
  const missing = REQUIRED.filter((name) => {
    const value = input[name];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
  if (missing.length > 0) throw new Error(`Missing deployment record fields: ${missing.join(", ")}`);
  return {
    schemaVersion: 1,
    recordedAt: now().toISOString(),
    status: "planned",
    commit: input.commit,
    executor: input.executor,
    environment: input.environment,
    tests: input.tests,
    dbImpact: input.dbImpact,
    rollbackVersion: input.rollbackVersion,
    approver: input.approver,
    postDeployEvidence: [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const input = JSON.parse(process.argv[2] ?? "{}");
    console.log(JSON.stringify(createDeploymentRecord(input), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to create deployment record.");
    process.exitCode = 1;
  }
}
