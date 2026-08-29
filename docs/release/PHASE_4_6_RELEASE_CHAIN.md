# Phase 4–6 product, integration, and release chain

Status: **foundation only — production deployment remains blocked**.

## Phase 4 tracer contract

`src/server/product/core-business-tracer.ts` defines the server-side sequence:

`Admin creates client → invitation accepted → service assigned → invoice issued → client views invoice → payment recorded → support ticket opened → audit trail`

The orchestration validates actor role and tenant on every command, links an accepted invitation to the client identity, validates state transitions and money/currency, hashes invitation tokens at rest, expires invitations, writes audit events, and requires optimistic-version persistence through `BusinessSliceRepository`.

A Supabase repository, migrations/RLS, route/action bindings, authenticated browser fixtures, and desktop/mobile UAT are intentionally not added here because the parallel Security/Data and Quality streams own those dependencies. The contract tests are not evidence that those gates have passed.

## Phase 5 integration foundations

All external integrations default **OFF**:

- `FEATURE_PAYMENTS_ENABLED=false`
- `FEATURE_EMAIL_ENABLED=false`
- `FEATURE_AUTOMATION_ENABLED=false`

Payment webhook handling signs a canonical JSON array containing `"nexus-payment-webhook-v1"`, provider, event ID, timestamp, and the exact raw body. It rejects malformed, future, and stale timestamps before processing. Processing requires a durable inbox adapter that atomically begins a fenced lease, marks successful work complete, releases retryable failures, and permanently rejects completed replays. This branch defines only that port: it does not claim or enable a concrete database adapter. Email is behind a provider port. Automation requires a database-backed job store with unique idempotency keys and persisted leases; an in-memory worker claim is not an allowed implementation. Health checks distinguish configuration from successful live probes.

No provider adapter, credential, webhook route, email send, worker, or integration activation is included.

## Phase 6 release commands

These commands run the Product/Integration/Release evidence gate and its individual checks; none deploys:

```bash
npm test
npm run typecheck
npm run build
# Equivalent combined gate:
npm run quality
```

These release commands validate or prepare evidence; none deploys:

```bash
node scripts/release/validate-environment.mjs
node scripts/release/create-deployment-record.mjs '{"commit":"<sha>","executor":"<human-or-ci>","environment":"staging","tests":["<executed check>"],"dbImpact":"none or migration ids","rollbackVersion":"<sha>","approver":"<human>"}' > deployment-record.json
node scripts/release/prepare-rollback.mjs '{"currentVersion":"<sha>","rollbackVersion":"<sha>","environment":"staging","approver":"<human>"}'
node scripts/release/post-deploy-verify.mjs https://staging.example.test
```

### Mandatory human-controlled gates

1. Use isolated development, test/staging, and production environments.
2. Install rotated credentials only through approved secret storage.
3. Rehearse migrations, rollback, backup, and restore on staging.
4. Attach security review, regression, authenticated E2E, and UAT evidence.
5. Obtain explicit human release approval.
6. Deploy in a controlled window through the authorized platform.
7. Run the health script, then authenticated permission/data-integrity/core-journey checks and retain evidence.

The post-deploy script is deliberately read-only and checks the real `/api/health` response. Authenticated permission, data integrity, and core-journey verification remain blocked until approved test fixtures and the Security/Data/Quality streams are integrated.
