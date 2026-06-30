import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Stripe webhook cache sync (Step 4).
 * Requires STRIPE_WEBHOOK_SECRET in production.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  let payload: {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const eventType = payload.type ?? "unknown";
  const obj = payload.data?.object ?? {};

  if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.created") {
    const subId = String(obj.id ?? "");
    const customerId = String(obj.customer ?? "");
    const status = String(obj.status ?? "inactive");
    const periodEnd = obj.current_period_end
      ? new Date(Number(obj.current_period_end) * 1000).toISOString()
      : null;

    const metadata = obj.metadata as Record<string, unknown> | undefined;

    await supabase.from("stripe_subscriptions").upsert(
      {
        stripe_subscription_id: subId,
        stripe_customer_id: customerId,
        status,
        current_period_end: periodEnd,
        user_id: String(metadata?.user_id ?? "00000000-0000-0000-0000-000000000000"),
        module_id: String(metadata?.module_id ?? "00000000-0000-0000-0000-000000000000"),
      },
      { onConflict: "stripe_subscription_id" }
    );
  }

  await supabase.from("platform_audit_events").insert({
    action: "stripe_webhook",
    actor_tier: "system",
    target_type: "stripe_event",
    target_id: eventType,
    payload: { received: true },
  });

  return NextResponse.json({ received: true });
}
