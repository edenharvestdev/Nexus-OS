import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserProfile } from "@/types/auth";
import { ProfileRow } from "@/types/database";
import { UserRole, USER_ROLES } from "@/constants/auth";
import { resolveDatabaseRole } from "@/lib/auth/authorization";

/**
 * Retrieves the current authenticated user profile from Supabase Auth & public.profiles table.
 * Strictly validated on the server. Blocked for suspended or soft-deleted accounts.
 * Supports Admin 1-Click Client Impersonation mode.
 */
export async function getCurrentUser(options?: { ignoreImpersonation?: boolean }): Promise<UserProfile | null> {
  try {
    let baseUser: UserProfile | null = null;

    // 1. Live Supabase Auth session check
    const supabase = await createServerSupabaseClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return null;
    } else {
      // 2. Retrieve profile from public.profiles
      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();

      const typedProfile = profile as ProfileRow | null;

      if (!typedProfile) {
        return null;
      } else {
        // Block soft-deleted or suspended users on the server
        if (typedProfile.deleted_at || typedProfile.account_status === "suspended") {
          return null;
        }

        const role = resolveDatabaseRole(typedProfile.role);
        if (!role) return null;

        baseUser = {
          id: typedProfile.id,
          email: typedProfile.email,
          fullName: typedProfile.full_name,
          avatarUrl: typedProfile.avatar_url,
          role,
          phone: typedProfile.phone,
          companyName: typedProfile.company_name,
          timezone: typedProfile.timezone || "UTC",
          language: typedProfile.language || "en",
          accountStatus: (typedProfile.account_status as any) || "active",
          createdAt: typedProfile.created_at,
          updatedAt: typedProfile.updated_at,
        };
      }
    }

    if (!baseUser) return null;

    // 3. Admin Impersonation Mode check (1-Click Client Login)
    if (baseUser.role === USER_ROLES.ADMIN && !options?.ignoreImpersonation) {
      try {
        const cookieStore = await cookies();
        const impersonatedClientId = cookieStore.get("nexusos_impersonate_client_id")?.value;

        if (impersonatedClientId) {
          const adminSupabase = createAdminClient() as any;
          const { data: client } = await adminSupabase
            .from("clients")
            .select("*")
            .eq("id", impersonatedClientId)
            .maybeSingle();

          if (client) {
            return {
              id: client.profile_id || `client-${client.id}`,
              email: client.primary_email,
              fullName: client.full_name || client.company_name,
              avatarUrl: client.company_logo_url || null,
              role: USER_ROLES.CLIENT, // Impersonated Client role
              phone: client.primary_phone || null,
              companyName: client.company_name,
              timezone: client.timezone || "UTC",
              language: client.preferred_language || "en",
              accountStatus: (client.client_status === "suspended" ? "suspended" : "active") as any,
              createdAt: client.created_at,
              updatedAt: client.updated_at || client.created_at,
              isImpersonating: true,
              impersonatedClientId: client.id,
              originalAdminName: baseUser.fullName || baseUser.email,
            };
          }
        }
      } catch (e) {
        // Fall back to base admin user if cookie parsing fails
      }
    }

    return baseUser;
  } catch (error) {
    console.error("Failed to retrieve current user session:", error);
    return null;
  }
}

/**
 * Requires an authenticated user session on the server.
 * Redirects unauthenticated users to login path.
 */
export async function requireAuth(redirectTo: string = "/login"): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(redirectTo);
  }
  return user;
}

/**
 * Requires a specific role on the server. Redirects unauthorized users.
 * Prevents privilege escalation.
 */
export async function requireRole(
  allowedRoles: UserRole[],
  fallbackRedirect: string = "/client"
): Promise<UserProfile> {
  const user = await requireAuth();
  if (!allowedRoles.includes(user.role)) {
    redirect(fallbackRedirect);
  }
  return user;
}

/**
 * Requirement helper for Admin access.
 * Only Admin role permitted. Ignores client impersonation when checking admin panel access.
 */
export async function requireAdmin(): Promise<UserProfile> {
  const user = await getCurrentUser({ ignoreImpersonation: true });
  if (!user || user.role !== USER_ROLES.ADMIN) {
    redirect("/client");
  }
  return user;
}

/**
 * Requirement helper for Client access.
 * Client and Admin permitted.
 */
export async function requireClient(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user || (user.role !== USER_ROLES.CLIENT && user.role !== USER_ROLES.ADMIN)) {
    redirect("/login");
  }
  return user;
}
