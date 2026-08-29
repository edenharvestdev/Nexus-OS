import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveDatabaseRole } from "@/lib/auth/authorization";
import { USER_ROLES } from "@/constants/auth";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/client";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const { data: profile, error: profileError } = await (supabase as any)
        .from("profiles")
        .select("role, account_status, deleted_at")
        .eq("id", data.user.id)
        .single();
      const role = resolveDatabaseRole(profile?.role);

      if (!profileError && role && !profile.deleted_at && profile.account_status !== "suspended") {
        const destination = role === USER_ROLES.ADMIN ? "/admin" : safeNext;
        return NextResponse.redirect(new URL(destination, request.url));
      }

      await supabase.auth.signOut();
    }
  }

  return NextResponse.redirect(new URL("/login?error=AuthCallbackFailed", request.url));
}
