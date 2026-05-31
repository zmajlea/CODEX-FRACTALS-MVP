import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const siteUrl = getSiteUrl(origin);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/switchboard";

  if (!next.startsWith("/") || next.startsWith("//")) {
    next = "/switchboard";
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const displayName =
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null;

        await supabase.from("users").upsert(
          {
            id: user.id,
            email: user.email ?? "",
            display_name: displayName,
            avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
          },
          { onConflict: "id" }
        );
      }

      return NextResponse.redirect(`${siteUrl}${next}`);
    }
  }

  return NextResponse.redirect(
    `${siteUrl}/login?error=${encodeURIComponent("Google sign-in failed. Try again.")}`
  );
}
