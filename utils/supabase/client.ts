import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function createClient() {
  if (!supabaseUrl || !supabaseKey) {
    // Build/SSR prerender must not hard-fail when Vercel env is runtime-only.
    if (typeof window === "undefined") {
      return createBrowserClient<Database>(
        "https://placeholder.supabase.co",
        "placeholder-anon-key"
      );
    }
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
