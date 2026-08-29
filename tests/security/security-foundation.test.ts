import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { registerSchema } from "../../src/features/auth/schemas/auth-schemas";
import {
  authorizeTenantAccess,
  resolveDatabaseRole,
} from "../../src/lib/auth/authorization";
import {
  protectCredential,
  revealCredential,
  type CredentialSecretProvider,
} from "../../src/lib/security/credential-secret-provider";

const validRegistration = {
  fullName: "Client User",
  email: "client@example.test",
  password: "Password1",
  agreeToTerms: true,
};

test("public registration rejects any client-supplied role", () => {
  const result = registerSchema.safeParse({ ...validRegistration, role: "admin" });
  assert.equal(result.success, false);
});

test("database-backed role resolution fails closed", () => {
  assert.equal(resolveDatabaseRole("admin"), "admin");
  assert.equal(resolveDatabaseRole("client"), "client");
  assert.equal(resolveDatabaseRole(undefined), null);
  assert.equal(resolveDatabaseRole("owner"), null);
});

test("tenant lookups use immutable profile ownership rather than email fallbacks", () => {
  const files = [
    "src/features/billing/actions/billing-actions.ts",
    "src/features/billing/actions/payment-actions.ts",
    "src/features/support/actions/support-actions.ts",
    "src/features/notifications/actions/communication-actions.ts",
    "src/features/services/actions/service-actions.ts",
  ];

  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /primary_email\.eq\.\$\{user\.email\}/);
  }
});

test("authorization matrix allows admins and a client owning the tenant resource", () => {
  assert.equal(authorizeTenantAccess({ role: "admin", userId: "admin" }, "client-b", "client-a"), true);
  assert.equal(authorizeTenantAccess({ role: "client", userId: "user-a" }, "client-a", "client-a"), true);
});

test("authorization matrix denies cross-account and unauthenticated access", () => {
  assert.equal(authorizeTenantAccess({ role: "client", userId: "user-a" }, "client-b", "client-a"), false);
  assert.equal(authorizeTenantAccess(null, "client-a", "client-a"), false);
});

test("credential handling fails closed without an approved server provider", async () => {
  await assert.rejects(() => protectCredential("secret"), /provider is not configured/i);
  await assert.rejects(() => revealCredential("protected"), /provider is not configured/i);
});

test("credential handling delegates to an explicitly supplied provider", async () => {
  const provider: CredentialSecretProvider = {
    async protect(value) {
      return `vault:${value}`;
    },
    async reveal(value) {
      return value.replace(/^vault:/, "");
    },
  };

  assert.equal(await protectCredential("secret", provider), "vault:secret");
  assert.equal(await revealCredential("vault:secret", provider), "secret");
});

test("security migration protects role authority and tenant tables", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260829000016_security_data_foundation.sql"),
    "utf8",
  );

  assert.match(migration, /prevent_profile_role_escalation/i);
  assert.match(migration, /OLD\.role/i);
  assert.match(migration, /service_credentials[\s\S]*ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /notifications[\s\S]*client_id[\s\S]*auth\.uid\(\)/i);
  assert.match(migration, /ticket_messages[\s\S]*WITH CHECK/i);
});

test("middleware and auth callback never trust user metadata for roles", () => {
  const middleware = readFileSync(join(process.cwd(), "src/lib/supabase/middleware.ts"), "utf8");
  const callback = readFileSync(join(process.cwd(), "src/app/(auth)/callback/route.ts"), "utf8");

  assert.doesNotMatch(middleware, /user_metadata\?\.role/i);
  assert.doesNotMatch(callback, /user_metadata\?\.role/i);
  assert.match(middleware, /from\("profiles"\)/i);
  assert.match(callback, /from\("profiles"\)/i);
});

test("new-user trigger never trusts role metadata", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260722000001_phase3_auth_profiles.sql"),
    "utf8",
  );

  assert.doesNotMatch(migration, /raw_user_meta_data->>'role'/i);
  assert.match(migration, /'client'::public\.user_role/i);
});
