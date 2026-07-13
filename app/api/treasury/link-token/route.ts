import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { canAccessModule } from "@/lib/auth/rbac";
import { plaid } from "@/lib/server/plaid";
import { createClient } from "@/utils/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canAccessModule(supabase, user.id, "treasury");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // ES included for future Bankinter/Kutxabank; inert in Sandbox (test institutions only).
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Fractals Treasury",
      products: [Products.Transactions],
      country_codes: [CountryCode.Es, CountryCode.Us],
      language: "en",
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error("[treasury/link-token]", err);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 502 }
    );
  }
}
