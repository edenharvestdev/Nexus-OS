"use server";

import type { SystemHealthCheck } from "@/types/setup";

const SETUP_DISABLED = "Web setup is disabled. Provision the initial administrator through an approved, authenticated operator workflow.";

export async function checkSystemInitializationAction() {
  return { success: false, systemInitialized: false, appVersion: "1.0.0-enterprise", error: SETUP_DISABLED };
}

export async function runSystemHealthCheckAction(): Promise<{ success: boolean; checks: SystemHealthCheck[] }> {
  return { success: false, checks: [] };
}

export async function testEmailConfigAction(_rawValues: unknown) {
  return { success: false, error: SETUP_DISABLED, message: "" };
}

export async function finalizeInstallationAction(_setupPayload: unknown) {
  return { success: false, error: SETUP_DISABLED };
}
