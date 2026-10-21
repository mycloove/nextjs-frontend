import { safeNextPath } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { ANON_COOKIE, isAnonId } from "@/lib/usage/cookie";
import { claimAnonUsage, ensureProfileRecord, readAccountStatus, syncOAuthProfileIfNeeded } from "@/lib/usage/store";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      let role = "User";
      try {
        if (data.user) {
          await ensureProfileRecord(data.user.id, data.user.email ?? null);
          // OAuth providers (Google) carry the profile in user_metadata; fill
          // the owner row with it only where the row is still empty, so the
          // nav chip shows the provider photo instead of a bare initial.
          const meta =
            (data.user.user_metadata as Record<string, unknown> | null) ?? {};
          const providerName =
            typeof meta.full_name === "string" && meta.full_name.trim()
              ? meta.full_name
              : typeof meta.name === "string" && meta.name
                ? meta.name
                : typeof meta.display_name === "string"
                  ? meta.display_name
                  : null;
          const providerAvatar =
            typeof meta.avatar_url === "string" && meta.avatar_url
              ? meta.avatar_url
              : typeof meta.picture === "string" && meta.picture
                ? meta.picture
                : null;
          await syncOAuthProfileIfNeeded(
            data.user.id,
            data.user.email ?? null,
            providerName,
            providerAvatar,
          );
          const status = await readAccountStatus(data.user.id);
          if (!status.active) {
            await supabase.auth.signOut();
            return NextResponse.redirect(`${origin}/login?error=inactive`);
          }
          role = status.role;
        }
      } catch {
        role = "User";
      }
      try {
        const jar = await cookies();
        const anonId = jar.get(ANON_COOKIE)?.value;
        if (data.user && isAnonId(anonId)) {
          await claimAnonUsage(data.user.id, anonId);
        }
      } catch {
        // The next conversion claims the same guest calls.
      }
      const dest = role !== "User" && next === "/" ? "/admin" : next;
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
