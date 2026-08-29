# Testing and quality checks

Use Node.js 22 and install the lockfile exactly:

```sh
npm ci
```

## Local gates

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage
npm run build
npm run audit
```

Vitest exercises production schemas and shared utilities. Coverage output is written to `coverage/`.

## Authenticated browser tests

Install the macOS-compatible Chromium build once:

```sh
npm run test:e2e:install
```

Authenticated tests use Playwright's isolated built-in page/context fixture so project `use` options are preserved. Provide credentials only through the environment or an untracked local secret store:

- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
- `E2E_CLIENT_A_EMAIL` / `E2E_CLIENT_A_PASSWORD`
- `E2E_CLIENT_B_EMAIL` / `E2E_CLIENT_B_PASSWORD`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` for a dedicated test backend

Playwright always starts and targets the checked-out application at `http://127.0.0.1:3000`; arbitrary external application URLs are intentionally unsupported. The Supabase variables and actor accounts must belong to a dedicated test backend. Never target production or reuse production credentials.

```sh
npm run test:e2e
```

The fixture loader fails closed before login when any actor credential is absent. Playwright retains traces, screenshots, and video for failures in `test-results/`; CI uploads those files and the HTML report for three days because they may contain sensitive test data.

## CI

`.github/workflows/quality.yml` runs clean install, ESLint, TypeScript (including tests and runner configs), Vitest coverage, build, production dependency audit, authenticated Playwright against the checked-out app, and full-history Gitleaks scanning. ESLint permits the acknowledged baseline of 608 existing application warnings and fails if that budget is exceeded.

Repository secrets must supply the six actor variables plus `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY` for the dedicated test backend; missing values fail the authenticated job with variable names only. GitHub does not expose those secrets to fork pull requests, so authenticated E2E is explicitly skipped there. After reviewing a fork contribution, maintainers must run the workflow from a trusted branch before merge; secrets must never be added to fork code or logs.
