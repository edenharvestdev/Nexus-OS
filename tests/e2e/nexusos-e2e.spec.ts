import { expect, test } from "./fixtures/authenticated";

test.describe("authenticated role fixtures", () => {
  test("Admin can open the administrative dashboard", async ({ adminPage }) => {
    await expect(adminPage).toHaveURL(/\/admin(?:\/|$)/);
    await expect(adminPage.locator("main")).toBeVisible();
  });

  test("Client A can open its client dashboard", async ({ clientAPage }) => {
    await expect(clientAPage).toHaveURL(/\/client(?:\/|$)/);
    await expect(clientAPage.locator("main")).toBeVisible();
  });

  test("Client B can open its client dashboard", async ({ clientBPage }) => {
    await expect(clientBPage).toHaveURL(/\/client(?:\/|$)/);
    await expect(clientBPage.locator("main")).toBeVisible();
  });
});
