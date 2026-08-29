---
title: Nexus-OS security remediation and release-readiness plan
status: approved-for-execution-planning
risk_level: "Level 3 — Critical"
baseline_commit: 2d5cca8c216c2bf9ada9f982d8bdf201c86e6e9a
last_reviewed: 2026-08-15
owners:
  - Human Project Owner
  - AURELIS Software Factory
tags: [nexus-os, security, remediation, release-readiness, knowledge-base]
---

# Nexus-OS security remediation and release-readiness plan

## Executive summary

Nexus-OS เป็น Business Operations / Enterprise CRM แบบ Modular Monolith บน Next.js และ Supabase มี Admin Portal, Client Portal, CRM, Services, Billing, Support, Documents, Notifications, Automation, Analytics และ Operations

Repository สามารถติดตั้ง TypeScript-check และสร้าง production build ได้ แต่ยังไม่ควรถูก Deploy เป็น Production เนื่องจากมีความเสี่ยง Critical ด้าน role escalation, committed secrets, authentication fallback และ cross-tenant access รวมถึงยังไม่มี test/CI evidence ที่ผลิตซ้ำคำกล่าวว่า Production-ready ได้

เป้าหมายของแผนนี้คือเปลี่ยนระบบจาก **claimed production-ready** เป็น **evidence-based release candidate** โดยไม่ขยาย Product Scope จนกว่าจะปิดความเสี่ยงระดับ Critical และ High ที่เป็น Release Blocker

## Baseline

- Repository: `Moparapairayat/Nexus-OS`
- Default branch: `main`
- Reviewed commit: `2d5cca8c216c2bf9ada9f982d8bdf201c86e6e9a`
- Stack: Next.js 16, React 19, TypeScript, Supabase Auth/PostgreSQL/RLS/Storage/Realtime
- Architecture: Modular Monolith / Vertical Slice
- Measured shape: 283 source-like files, 23,967 code lines, 41 pages, 4 route handlers, 26 Server Action files, 16 migrations, 57 migration-defined tables and 2 test files

## Executed evidence at baseline

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm ci` | Pass | Dependencies install from the lockfile |
| `npm run typecheck` | Pass | Application TypeScript passes; tests/config are excluded |
| `npm run build` | Pass | Production bundle can be generated |
| `npm run lint` | Fail | Script uses `next lint`, which is not valid in the installed Next.js 16 toolchain |
| `npm test` | Not configured | No reproducible package-level test command |
| Test runners | Missing | No ready top-level Vitest, Jest or Playwright installation |
| Dependency audit | High findings | Dependency remediation is required before release |

`QA_REPORT.md` is an assertion, not release evidence, until the repository can reproduce its results through deterministic commands and retained artifacts.

## Current policy state

- Risk level: **Level 3 — Critical**
- Product status: **Feature Freeze / Security Remediation**
- Production deployment: **Blocked**
- Merge, credential rotation, production access and deployment require explicit human approval
- Risk closes only with code change, executed evidence and independent review

## Release-blocking risks

### Critical — Public registration can influence Admin role

Observed trust chain:

- Public registration accepts an Admin role.
- Registration forwards client-controlled role data into Supabase metadata.
- Database/profile creation and routing trust metadata.
- Missing-profile fallback can resolve to Admin.

Required outcome:

- Public registration is disabled until fixed.
- Browser input cannot select privileged roles.
- Role authority is server/database controlled.
- Missing or ambiguous identity fails closed to the least-privileged state.

### Critical — Secrets were committed to Git

A tracked `.env.local` contains secret-bearing variables, including a Supabase service-role key and application secret. Secret values must not be copied into documentation, issues, pull requests or chat.

Required outcome:

- Revoke and rotate affected credentials.
- Inspect provider/access logs.
- Remove the file from tracking and purge sensitive history.
- Add secret scanning and environment separation.

### Critical — Setup/Admin authentication fallback

The setup flow lacks a strong one-time authorization boundary, stores password-related state in process memory and can produce an Admin-like identity without a valid durable Supabase session.

Required outcome:

- Remove the fallback mechanism.
- Replace it with a one-time authenticated, durable and auditable setup process.
- Never retain plaintext passwords in process state.

### High — Service-role IDOR and cross-tenant access

Several client-facing Server Actions use a service-role client that bypasses RLS while accepting object identifiers without complete ownership enforcement.

Required outcome:

- Prefer session-scoped data access for client flows.
- Require tenant/ownership predicates on every object operation.
- Cover Allow, Deny, Cross-account and Unauthenticated behavior with executed tests.

### High — Credential Vault does not provide verified encryption

Credential fields are written without evidence of an appropriate encryption boundary, and ownership checks are incomplete.

Required outcome:

- Use a dedicated secret manager or envelope encryption.
- Keep decryption server-only and minimize secret return.
- Audit every secret access and enforce tenant ownership.

### High — Incomplete RLS coverage

Multiple domain tables lack complete RLS evidence. Profile update policy also requires column-level protection so users cannot change privileged role fields.

Required outcome:

- Maintain an actor-operation matrix for Anonymous, Client A, Client B, Admin and Service Role.
- Test every table and Storage policy on an ephemeral database.

### High — Migration chain is not proven from zero

Policy naming/order conflicts can stop a clean migration run.

Required outcome:

- Run all migrations against an empty ephemeral database.
- Repair ordering and idempotency where required.
- Retain schema, seed, rollback and rehearsal evidence.

### High — Payment and automation claims exceed implementation evidence

Payment documentation describes UddoktaPay behavior without a complete checkout/webhook/callback verification path. Automation has schema/UI but no proven durable execution worker.

Required outcome:

- Keep payment activation and automation execution disabled.
- Implement and test signature verification, replay protection, amount/currency validation and idempotency before activation.
- Either implement durable automation runtime or label the module as configuration/simulation only.

## Delivery plan

## Phase 0 — Containment

1. Disable public registration.
2. Revoke and rotate committed credentials using a human-approved access path.
3. Remove `.env.local` from tracking and purge sensitive history.
4. Remove Admin/setup authentication fallback.
5. Contain known service-role cross-tenant paths.
6. Correct release/QA claims that are not reproducible.
7. Preserve Feature Freeze until the Critical gate passes.

### Exit gate

- No client-controlled privileged role.
- No active leaked credential.
- No unauthenticated Admin fallback.
- Critical cross-tenant paths are blocked and independently reviewed.

## Phase 1 — Identity and tenant isolation

1. Define database-backed role authority and role transition rules.
2. Update middleware, callbacks and session helpers to fail closed.
3. Inventory every Server Action by actor, resource and operation.
4. Replace unnecessary service-role calls with session-scoped clients.
5. Enforce tenant ownership at query and policy boundaries.
6. Review Admin impersonation lifecycle, expiry, audit and exit behavior.
7. Execute Allow, Deny, Cross-account and Unauthenticated tests.

### Exit gate

Every protected operation has explicit authentication, authorization, validation and tenant-isolation evidence.

## Phase 2 — Database, RLS, migrations and secrets

1. Create the complete actor-operation RLS matrix.
2. Add/fix RLS and Storage policies for every domain table/bucket.
3. Protect profile role columns from self-escalation.
4. Rehearse the full migration chain on an empty database.
5. Add schema-drift and migration-order checks.
6. Redesign Credential Vault with a proven encryption/secret-manager boundary.
7. Test backup, restore and rollback.

### Exit gate

A clean ephemeral environment can be created, migrated, tested and rolled back with no cross-tenant leakage.

## Phase 3 — Quality harness and CI

1. Replace invalid `next lint` usage with a supported ESLint configuration.
2. Install and configure a unit/integration test runner.
3. Install and configure Playwright with authenticated Admin, Client A and Client B fixtures.
4. Include tests and Playwright configuration in TypeScript checking.
5. Add CI for clean install, lint, typecheck, unit/integration, authenticated E2E, build, dependency audit and secret scan.
6. Retain command output and test artifacts.
7. Resolve production-path dependency vulnerabilities.

### Exit gate

A clean checkout can reproduce all mandatory checks through documented commands, and CI blocks merge on failure.

## Phase 4 — Core product slice

Prove one complete business path before expanding modules:

`Admin creates client → Client accepts invitation → Assign service → Issue invoice → Client sees invoice → Payment recorded → Support ticket → Audit trail`

The slice must include:

- Authentication and authorization
- Tenant isolation and RLS
- Input validation and error states
- Unit, integration and authenticated E2E evidence
- Audit trail
- Migration and rollback compatibility
- Desktop/mobile acceptance evidence for relevant journeys

### Exit gate

The business outcome passes security, data, QA and human UAT gates without relying on synthetic status.

## Phase 5 — Real integrations

After the foundation and core slice pass:

1. Implement payment checkout, callback/webhook authenticity, replay protection and idempotency.
2. Integrate the approved email provider with delivery evidence.
3. Activate the secure credential-storage boundary.
4. Implement a durable background worker for automation.
5. Replace synthetic health statuses with real probes and alerts.

### Exit gate

Each external integration has sandbox evidence, failure handling, retry/idempotency policy, observability and rollback/disable controls.

## Phase 6 — Release readiness

1. Create isolated Development, Test/Staging and Production environments.
2. Install newly rotated environment credentials through approved secret storage.
3. Rehearse migrations and rollback against Staging.
4. Test backup and restore.
5. Complete security review, regression testing and UAT.
6. Prepare deployment record: commit, executor, tests, DB impact, rollback version and approver.
7. Obtain explicit human release approval.
8. Deploy through a controlled window.
9. Run post-deploy health, permission, data-integrity and core-journey verification.

### Exit gate

Production status can be declared only after all mandatory gates pass and post-deploy verification is retained.

## Required authorization test matrix

| Actor | Allow | Deny | Cross-account | Unauthenticated |
| --- | --- | --- | --- | --- |
| Admin | Approved administrative operations | Forbidden system/owner-only operations | Tenant boundary remains explicit | N/A |
| Client A | Own allowed resources | Admin-only operations | Cannot read/write Client B | N/A |
| Client B | Own allowed resources | Admin-only operations | Cannot read/write Client A | N/A |
| Anonymous | Public-only behavior | Protected operations | No tenant data | Protected calls fail |
| Service Role | Approved server-only operation | No browser/client exposure | Explicit tenant predicate unless true global operation | Server-only credential boundary |

## Roles and independent gates

- Human Project Owner: scope, credential rotation, production access, merge and deployment approval
- Mission/Delivery: plan, dependencies, milestone and evidence completeness
- Security: auth, role, tenant, secrets, payment and service-role gate
- Data: schema, RLS, Storage, migration and rollback gate
- QA/UAT: deterministic tests, independent review and acceptance mapping
- Release/Operations: environment, deployment record, observability and post-deploy verification

The implementing agent or developer cannot independently approve the same change.

## Non-goals during remediation

- New CRM modules
- Broad UI redesign
- Production deployment before Critical/High release blockers close
- Payment activation before callback/signature/idempotency verification
- Autonomous credential rotation or production release
- Claims of completion based only on implementation status

## Completion language

Do not use `Done`, `Complete` or `Ready for Production` solely because implementation or build succeeds. A risk or phase closes only when mandatory code, executed evidence, independent review and required human approval exist.

## Immediate next action

Start Phase 0 with a scoped implementation blueprint for:

1. disabling public role selection,
2. replacing the metadata/default-Admin trust chain,
3. removing setup/auth fallback, and
4. defining a human-approved credential rotation and Git-history purge runbook.
