import { safeNextPath } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileRecord, readAccountStatus } from "@/lib/usage/store";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      let role = "User";
      try {
        if (data.user) {
          await ensureProfileRecord(data.user.id, data.user.email ?? null);
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
      const dest = role !== "User" && next === "/" ? "/admin" : next;
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
