import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { ANON_COOKIE, ANON_COOKIE_OPTIONS, isAnonId } from "@/lib/usage/cookie";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Refresh the auth token so Server Components and the browser stay in sync.
  await supabase.auth.getClaims();

  const hasAnon =
    isAnonId(request.cookies.get(ANON_COOKIE)?.value) ||
    isAnonId(supabaseResponse.cookies.get(ANON_COOKIE)?.value);
  if (!hasAnon) {
    supabaseResponse.cookies.set(ANON_COOKIE, randomUUID(), ANON_COOKIE_OPTIONS);
  }

  return supabaseResponse;
}
