"use server";

import { createSafeAction } from "@/lib/actions/create-safe-action";
import { registerSchema } from "../schemas/auth-schemas";

/** Public account creation is contained until invitation-only provisioning is proven. */
export const registerAction = createSafeAction(registerSchema, async () => {
  throw new Error("Public registration is disabled. Ask an administrator for an invitation.");
});
