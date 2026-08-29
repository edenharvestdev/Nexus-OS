export type HealthProbeDefinition = {
  name: string;
  configured: boolean;
  probe(): Promise<{ healthy: boolean; message: string }>;
};

export type HealthProbeResult = {
  name: string;
  configured: boolean;
  status: "healthy" | "unhealthy" | "not_configured";
  latencyMs: number;
  message: string;
};

export type HealthProbeReport = {
  overallStatus: "healthy" | "degraded" | "unhealthy";
  checkedAt: string;
  services: HealthProbeResult[];
};

export async function probeHttpService(
  url: string,
  headers: Record<string, string>,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ healthy: boolean; message: string }> {
  const response = await fetcher(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  return response.ok
    ? { healthy: true, message: `Probe returned HTTP ${response.status}.` }
    : { healthy: false, message: `Probe returned HTTP ${response.status}.` };
}

export async function runHealthProbes(definitions: HealthProbeDefinition[]): Promise<HealthProbeReport> {
  const services = await Promise.all(
    definitions.map(async (definition): Promise<HealthProbeResult> => {
      if (!definition.configured) {
        return { name: definition.name, configured: false, status: "not_configured", latencyMs: 0, message: "Service is not configured." };
      }
      const startedAt = performance.now();
      try {
        const outcome = await definition.probe();
        return {
          name: definition.name,
          configured: true,
          status: outcome.healthy ? "healthy" : "unhealthy",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          message: outcome.message,
        };
      } catch (error) {
        return {
          name: definition.name,
          configured: true,
          status: "unhealthy",
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          message: error instanceof Error ? error.message : "Probe failed.",
        };
      }
    }),
  );

  const overallStatus = services.some((service) => service.status === "unhealthy")
    ? "unhealthy"
    : services.some((service) => service.status === "not_configured")
      ? "degraded"
      : "healthy";
  return { overallStatus, checkedAt: new Date().toISOString(), services };
}
