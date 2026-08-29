#!/usr/bin/env node

const REQUIRED = [
  "RELEASE_ENVIRONMENT",
  "RELEASE_COMMIT_SHA",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const FLAGS = ["FEATURE_PAYMENTS_ENABLED", "FEATURE_EMAIL_ENABLED", "FEATURE_AUTOMATION_ENABLED"];

export function validateReleaseEnvironment(env) {
  const errors = [];
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) errors.push(`${name} is required.`);
  }
  if (env.RELEASE_ENVIRONMENT && !["development", "test", "staging", "production"].includes(env.RELEASE_ENVIRONMENT)) {
    errors.push("RELEASE_ENVIRONMENT must be development, test, staging, or production.");
  }
  for (const flag of FLAGS) {
    if (env[flag] !== undefined && !["true", "false"].includes(env[flag])) errors.push(`${flag} must be true or false.`);
  }
  if (FLAGS.some((flag) => env[flag] === "true") && !env.RELEASE_APPROVER?.trim()) {
    errors.push("RELEASE_APPROVER is required when an external integration is enabled.");
  }
  if (["staging", "production"].includes(env.RELEASE_ENVIRONMENT)) {
    for (const name of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (env[name] && !env[name].startsWith("https://")) errors.push(`${name} must use HTTPS outside development/test.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateReleaseEnvironment(process.env);
  if (!result.ok) {
    console.error("Release environment validation failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Release environment validation passed (values withheld).");
  }
}
