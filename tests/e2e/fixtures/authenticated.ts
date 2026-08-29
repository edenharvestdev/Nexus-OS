import { expect, test as base, type Page } from "@playwright/test";

type Actor = "admin" | "clientA" | "clientB";

type ActorCredentials = {
  email: string;
  password: string;
};

const credentialVariables: Record<Actor, readonly [string, string]> = {
  admin: ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"],
  clientA: ["E2E_CLIENT_A_EMAIL", "E2E_CLIENT_A_PASSWORD"],
  clientB: ["E2E_CLIENT_B_EMAIL", "E2E_CLIENT_B_PASSWORD"],
};

function requireCredentials(actor: Actor): ActorCredentials {
  const [emailVariable, passwordVariable] = credentialVariables[actor];
  const email = process.env[emailVariable]?.trim();
  const password = process.env[passwordVariable];
  const missing = [
    !email && emailVariable,
    !password && passwordVariable,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Authenticated E2E is fail-closed: missing ${missing.join(", ")} for ${actor}.`,
    );
  }

  return { email: email!, password: password! };
}

async function authenticate(page: Page, actor: Actor): Promise<void> {
  const credentials = requireCredentials(actor);
  const destination = actor === "admin" ? "/admin" : "/client";

  await page.goto("/login");
  await page.getByLabel("Email Address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => url.pathname.startsWith(destination));
}

async function authenticatedPage(
  page: Page,
  actor: Actor,
  provide: (page: Page) => Promise<void>,
): Promise<void> {
  await authenticate(page, actor);
  await provide(page);
}

export const test = base.extend<{
  adminPage: Page;
  clientAPage: Page;
  clientBPage: Page;
}>({
  adminPage: async ({ page }, use) => authenticatedPage(page, "admin", use),
  clientAPage: async ({ page }, use) => authenticatedPage(page, "clientA", use),
  clientBPage: async ({ page }, use) => authenticatedPage(page, "clientB", use),
});

export { expect };
