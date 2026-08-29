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

Authenticated tests use three isolated browser contexts. Provide credentials only through the environment or an untracked local secret store:

- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
- `E2E_CLIENT_A_EMAIL` / `E2E_CLIENT_A_PASSWORD`
- `E2E_CLIENT_B_EMAIL` / `E2E_CLIENT_B_PASSWORD`

Optionally set `PLAYWRIGHT_BASE_URL` to a dedicated test deployment. Without it, Playwright starts the local development server at `http://127.0.0.1:3000`. Never target production or reuse production credentials.

```sh
npm run test:e2e
```

The fixture loader fails closed before login when any actor credential is absent. Playwright retains traces, screenshots, and video for failures in `test-results/`; CI uploads those files and the HTML report.

## CI

`.github/workflows/quality.yml` runs clean install, ESLint, TypeScript (including tests and runner configs), Vitest coverage, build, production dependency audit, authenticated Playwright, and full-history Gitleaks scanning. Repository secrets must supply the six actor variables and `PLAYWRIGHT_BASE_URL`; missing values intentionally fail the authenticated job.
