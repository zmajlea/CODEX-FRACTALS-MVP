import { NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/request-origin";
import { afterAuthBootstrap, resolveLoginPath } from "@/lib/auth/rbac";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteUrl = getRequestOrigin(request);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? null;

  if (next && (!next.startsWith("/") || next.startsWith("//"))) {
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
        await afterAuthBootstrap(supabase, user);
      }

      const target = next ?? (await resolveLoginPath(supabase));
      return NextResponse.redirect(`${siteUrl}${target}`);
    }
  }

  return NextResponse.redirect(
    `${siteUrl}/login?error=${encodeURIComponent("Google sign-in failed. Try again.")}`
  );
}
