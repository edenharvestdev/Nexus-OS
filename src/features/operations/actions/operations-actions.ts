"use server";

import {
  OperationsOverviewPayload,
  SystemHealthCheck,
  SystemErrorRecord,
  MaintenanceConfig,
  SystemErrorFilters,
} from "@/types/operations";
import { requireAdmin } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSupabaseHealthCheck } from "@/lib/supabase/health";
import { readIntegrationFeatureFlags } from "@/server/integrations/feature-flags";

function getAdmin() {
  return createAdminClient() as any;
}

export async function getOperationsOverviewAction() {
  await requireAdmin();
  const supabase = getAdmin();

  const [healthReport, maintenanceResult, errorsResult] = await Promise.all([
    runSupabaseHealthCheck(),
    supabase.from("maintenance_mode").select("*").limit(1).maybeSingle(),
    supabase.from("system_error_logs").select("id", { count: "exact", head: true }).eq("status", "unresolved"),
  ]);
  const maintData = maintenanceResult.data;
  const unresolvedCount = errorsResult.count;
  const checkedAt = healthReport.checkedAt;
  const healthChecks: SystemHealthCheck[] = healthReport.services.map((service) => ({
    id: `hc-${service.name}`,
    serviceName: service.name,
    status: service.status === "healthy" ? "operational" : service.status === "unhealthy" ? "outage" : "degraded",
    latencyMs: service.latencyMs,
    lastCheckedAt: checkedAt,
    message: service.message,
  }));
  const flags = readIntegrationFeatureFlags();
  for (const [name, enabled] of Object.entries(flags)) {
    healthChecks.push({
      id: `hc-${name}`,
      serviceName: name,
      status: "degraded",
      latencyMs: 0,
      lastCheckedAt: checkedAt,
      message: enabled ? "Enabled, but no provider-specific health probe is registered." : "Disabled by feature flag.",
    });
  }

  const maintenanceMode: MaintenanceConfig = {
    isEnabled: Boolean(maintData?.is_enabled),
    message: maintData?.message || "NexusOS is operating normally.",
    allowedIps: maintData?.allowed_ip_addresses || [],
    enabledAt: maintData?.enabled_at || undefined,
  };

  const payload: OperationsOverviewPayload = {
    systemUptimePercent: healthChecks.length === 0
      ? 0
      : Math.round((healthChecks.filter((check) => check.status === "operational").length / healthChecks.length) * 10_000) / 100,
    healthChecks,
    unresolvedErrorsCount: unresolvedCount || 0,
    maintenanceMode,
    nodeEnv: process.env.NODE_ENV || "production",
    supabaseRegion: "Configured by Supabase project",
    databaseVersion: "Not exposed by health probe",
    nextVersion: "Next.js 16",
  };

  return { success: true, data: payload };
}

export async function getSystemErrorLogsAction(filters: SystemErrorFilters = {}) {
  await requireAdmin();
  const supabase = getAdmin();

  let query = supabase
    .from("system_error_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (filters.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  const errorLogs: SystemErrorRecord[] = (data || []).map((e: any) => ({
    id: e.id,
    module: e.module || "general",
    errorMessage: e.error_message,
    stackTrace: e.stack_trace || undefined,
    severity: e.severity,
    status: e.status,
    createdAt: e.created_at,
  }));

  return { success: true, data: { errorLogs } };
}

export async function resolveErrorAction(errorId: string) {
  await requireAdmin();
  const supabase = getAdmin();

  const { error } = await supabase
    .from("system_error_logs")
    .update({ status: "resolved" })
    .eq("id", errorId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/operations");
  return { success: true };
}

export async function toggleMaintenanceModeAction(isEnabled: boolean, message?: string) {
  const user = await requireAdmin();
  const supabase = getAdmin();

  const customMsg = message || "NexusOS is undergoing scheduled maintenance. Services will resume shortly.";

  const { error } = await supabase
    .from("maintenance_mode")
    .upsert({
      id: "00000000-0000-0000-0000-000000000001",
      is_enabled: isEnabled,
      message: customMsg,
      enabled_at: isEnabled ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return { success: false, error: `Failed to toggle maintenance mode: ${error.message}` };
  }

  // Audit event
  await supabase.from("security_events").insert({
    actor_id: user.id,
    actor_name: user.fullName || user.email,
    action: `Toggled System Maintenance Mode to ${isEnabled ? "ENABLED" : "DISABLED"}`,
    category: "settings",
    severity: "warning",
    status: "success",
  });

  revalidatePath("/admin/operations");
  return { success: true };
}

export async function getMaintenanceStatusAction() {
  const supabase = getAdmin();

  const { data } = await supabase
    .from("maintenance_mode")
    .select("*")
    .limit(1)
    .maybeSingle();

  return {
    success: true,
    isEnabled: Boolean(data?.is_enabled),
    message: data?.message || "NexusOS is operating normally.",
  };
}
