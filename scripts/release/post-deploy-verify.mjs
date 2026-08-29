#!/usr/bin/env node

export async function verifyPostDeploy(baseUrl, fetcher = fetch) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Post-deploy verification requires HTTPS outside localhost.");
  }
  const response = await fetcher(new URL("/api/health", url), {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response is an explicit failed health check.
  }
  const checks = [{ name: "health", ok: response.ok && payload.success === true, status: response.status }];
  return { ok: checks.every((check) => check.ok), checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Usage: node scripts/release/post-deploy-verify.mjs <base-url>");
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyPostDeploy(baseUrl);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Post-deploy verification failed.");
      process.exitCode = 1;
    }
  }
}
