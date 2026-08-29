import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("Playwright harness regression guard", () => {
  it("authenticates through Playwright's configured page fixture", () => {
    const fixture = repositoryFile("tests/e2e/fixtures/authenticated.ts");

    expect(fixture).toMatch(/adminPage:\s*async\s*\(\{ page \}, use\)/);
    expect(fixture).not.toContain("browser.newContext(");
  });

  it("always targets the checked-out application through webServer", () => {
    const config = repositoryFile("playwright.config.ts");

    expect(config).toContain('const baseURL = "http://127.0.0.1:3000";');
    expect(config).toContain("baseURL,");
    expect(config).toContain("webServer: {");
    expect(config).not.toContain("PLAYWRIGHT_BASE_URL");
  });

  it("keeps CI application targeting local and budgets lint warnings", () => {
    const workflow = repositoryFile(".github/workflows/quality.yml");
    const packageJson = JSON.parse(repositoryFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(workflow).not.toContain("PLAYWRIGHT_BASE_URL");
    expect(packageJson.scripts.lint).toMatch(/--max-warnings\s+\d+/);
  });
});
