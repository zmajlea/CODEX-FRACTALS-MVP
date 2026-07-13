import { NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/request-origin";
import {
  isLegacyDefaultNext,
  resolvePostAuthPath,
  type AuthFlow,
} from "@/lib/auth/login-flow";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteUrl = getRequestOrigin(request);
  const code = searchParams.get("code");
  const flow = (searchParams.get("flow") === "portal" ? "portal" : "client") as AuthFlow;
  const invite = searchParams.get("invite");
  let next = searchParams.get("next");

  if (next && (!next.startsWith("/") || next.startsWith("//"))) {
    next = null;
  }
  if (isLegacyDefaultNext(next)) {
    next = null;
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        try {
          const target = await resolvePostAuthPath(supabase, user, flow, {
            next,
            inviteToken: invite,
          });
          return NextResponse.redirect(`${siteUrl}${target}`);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Sign-in could not be completed.";
          const loginPath = flow === "portal" ? "/portal/login" : "/client/login";
          const params = new URLSearchParams({ error: message });
          if (invite) params.set("invite", invite);
          if (next) params.set("next", next);
          return NextResponse.redirect(`${siteUrl}${loginPath}?${params.toString()}`);
        }
      }
    }
  }

  const loginPath = flow === "portal" ? "/portal/login" : "/client/login";
  return NextResponse.redirect(
    `${siteUrl}${loginPath}?error=${encodeURIComponent("Google sign-in failed. Try again.")}`
  );
}
