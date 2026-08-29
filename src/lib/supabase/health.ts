import { probeHttpService, runHealthProbes, type HealthProbeReport } from "@/server/integrations/health-probes";
import { validateSupabaseEnv } from "./env";

export type SupabaseHealthReport = HealthProbeReport;

export async function runSupabaseHealthCheck(): Promise<SupabaseHealthReport> {
  const env = validateSupabaseEnv();
  const configured = env.isConfigured && Boolean(env.supabaseUrl && env.supabaseAnonKey);
  const baseUrl = env.supabaseUrl?.replace(/\/$/, "") ?? "";
  const headers: Record<string, string> = env.supabaseAnonKey
    ? { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}` }
    : {};

  return runHealthProbes([
    {
      name: "environment",
      configured,
      probe: async () => ({ healthy: true, message: "Required Supabase configuration is present." }),
    },
    {
      name: "database",
      configured,
      probe: () => probeHttpService(`${baseUrl}/rest/v1/`, headers),
    },
    {
      name: "auth",
      configured,
      probe: () => probeHttpService(`${baseUrl}/auth/v1/health`, headers),
    },
    {
      name: "storage",
      configured,
      probe: () => probeHttpService(`${baseUrl}/storage/v1/status`, headers),
    },
  ]);
}
