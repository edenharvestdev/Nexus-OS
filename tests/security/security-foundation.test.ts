import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { registerSchema } from "../../src/features/auth/schemas/auth-schemas";
import {
  authorizeTenantAccess,
  resolveDatabaseRole,
} from "../../src/lib/auth/authorization";
import { normalizeCallbackPath } from "../../src/lib/auth/callback-path";

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

test("credential provider is server-only, fail-closed, and has no caller override", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/security/credential-secret-provider.ts"),
    "utf8",
  );

  assert.match(source, /^import ["']server-only["'];/m);
  assert.match(source, /provider is not configured/i);
  assert.doesNotMatch(source, /protectCredential\([\s\S]*?provider\??:/i);
  assert.doesNotMatch(source, /revealCredential\([\s\S]*?provider\??:/i);
});

test("auth callback accepts only normalized same-origin paths", () => {
  assert.equal(normalizeCallbackPath("/client/tickets?open=1"), "/client/tickets?open=1");
  assert.equal(normalizeCallbackPath("//evil.example/path"), "/client");
  assert.equal(normalizeCallbackPath("/\\evil.example/path"), "/client");
  assert.equal(normalizeCallbackPath("/%5cevil.example/path"), "/client");
  assert.equal(normalizeCallbackPath("\\evil.example/path"), "/client");
  assert.equal(normalizeCallbackPath("https://evil.example/path"), "/client");
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
  assert.match(migration, /DROP POLICY IF EXISTS "client_insert_tickets"/i);
  assert.match(migration, /DROP POLICY IF EXISTS "client_insert_messages"/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.handle_new_user/i);
  assert.match(migration, /DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/i);
  assert.match(migration, /REVOKE UPDATE ON public\.support_tickets FROM authenticated/i);
  assert.match(migration, /GRANT UPDATE \(status, read_at\)[\s\S]*public\.notifications TO authenticated/i);
  assert.match(migration, /prevent_client_notification_mutation/i);
  assert.match(
    migration,
    /ALTER TABLE public\.service_credentials[\s\S]*ADD COLUMN IF NOT EXISTS login_url[\s\S]*ADD COLUMN IF NOT EXISTS secret_notes[\s\S]*GRANT SELECT/i,
  );
});

test("middleware and auth callback never trust user metadata for roles", () => {
  const middleware = readFileSync(join(process.cwd(), "src/lib/supabase/middleware.ts"), "utf8");
  const callback = readFileSync(join(process.cwd(), "src/app/(auth)/callback/route.ts"), "utf8");

  assert.doesNotMatch(middleware, /user_metadata\?\.role/i);
  assert.doesNotMatch(callback, /user_metadata\?\.role/i);
  assert.match(middleware, /from\("profiles"\)/i);
  assert.match(callback, /from\("profiles"\)/i);
});

test("forward migration replaces the new-user trigger without trusting role metadata", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260829000016_security_data_foundation.sql"),
    "utf8",
  );

  assert.doesNotMatch(migration, /raw_user_meta_data->>'role'/i);
  assert.match(migration, /'client'::public\.user_role/i);
});
