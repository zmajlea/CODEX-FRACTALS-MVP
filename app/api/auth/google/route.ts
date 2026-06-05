import { NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let next = searchParams.get("next") ?? "/switchboard";
  if (!next.startsWith("/") || next.startsWith("//")) {
    next = "/switchboard";
  }

  const origin = getRequestOrigin(request);
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        error?.message ?? "Could not start Google sign-in."
      )}`
    );
  }

  return NextResponse.redirect(data.url);
}
