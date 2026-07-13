import { NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/request-origin";
import type { AuthFlow } from "@/lib/auth/login-flow";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const flow = (searchParams.get("flow") === "portal" ? "portal" : "client") as AuthFlow;
  const next = searchParams.get("next");
  const invite = searchParams.get("invite");

  const origin = getRequestOrigin(request);
  const callbackParams = new URLSearchParams({ flow });
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    callbackParams.set("next", next);
  }
  if (invite) callbackParams.set("invite", invite);

  const redirectTo = `${origin}/auth/callback?${callbackParams.toString()}`;

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

  const loginPath = flow === "portal" ? "/portal/login" : "/client/login";

  if (error || !data.url) {
    return NextResponse.redirect(
      `${origin}${loginPath}?error=${encodeURIComponent(
        error?.message ?? "Could not start Google sign-in."
      )}`
    );
  }

  return NextResponse.redirect(data.url);
}
