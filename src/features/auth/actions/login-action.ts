"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSafeAction } from "@/lib/actions/create-safe-action";
import { loginSchema, LoginInput } from "../schemas/auth-schemas";
import { checkRateLimit } from "@/lib/auth/rate-limiter";
import { resolveDatabaseRole } from "@/lib/auth/authorization";
import { USER_ROLES } from "@/constants/auth";
import { ProfileRow } from "@/types/database";

export const loginAction = createSafeAction(loginSchema, async (data: LoginInput) => {
  const inputEmail = data.email.toLowerCase().trim();
  const rateLimit = checkRateLimit(`login:${inputEmail}`, 5, 60 * 1000);
  if (!rateLimit.success) {
    throw new Error("Too many failed sign-in attempts. Please wait 1 minute before trying again.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: inputEmail,
    password: data.password,
  });

  if (authError || !authData.user) {
    throw new Error("Invalid email or password combination.");
  }

  const { data: profile, error: profileError } = await (supabase as any)
    .from("profiles")
    .select("role, account_status, deleted_at")
    .eq("id", authData.user.id)
    .single();

  const typedProfile = profile as Partial<ProfileRow> | null;
  const role = resolveDatabaseRole(typedProfile?.role);
  if (profileError || !typedProfile || !role || typedProfile.deleted_at || typedProfile.account_status === "suspended") {
    await supabase.auth.signOut();
    throw new Error("Account authorization is unavailable. Contact an administrator.");
  }

  return {
    userId: authData.user.id,
    email: authData.user.email!,
    role,
    redirectUrl: role === USER_ROLES.ADMIN ? "/admin" : "/client",
  };
});
