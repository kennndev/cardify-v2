// app/api/stripe-webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- Supabase admin client ---------------- */
function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  return createClient(url, key);
}

/* ---------------- helpers ---------------- */
async function markSellerReadiness(acct: Stripe.Account) {
  const admin = getAdmin();
  const verified =
    acct.charges_enabled === true &&
    acct.payouts_enabled === true &&
    ((acct.requirements?.currently_due ?? []).length === 0);

  const userId = (acct.metadata as any)?.user_id as string | undefined;

  if (userId) {
    await admin.from("mkt_profiles").upsert(
      {
        id: userId,
        email: null,
        stripe_account_id: acct.id,
        stripe_verified: verified,
        is_seller: verified,
      },
      { onConflict: "id" }
    );
  }

  await admin
    .from("mkt_profiles")
    .update({ stripe_verified: verified, is_seller: verified })
    .eq("stripe_account_id", acct.id);
}

async function resolveAssetId(
  admin: ReturnType<typeof createClient>,
  listingId: string
): Promise<string | null> {
  const { data: l, error } = await admin
    .from("mkt_listings")
    .select("source_type, source_id")
    .eq("id", listingId)
    .single();

  if (error || !l) return null;

  if (l.source_type === "asset") return l.source_id as string;

  const { data: ua, error: err2 } = await admin
    .from("user_assets")
    .select("id")
    .eq("source_type", l.source_type)
    .eq("source_id", l.source_id)
    .limit(1)
    .maybeSingle();

  if (err2 || !ua) return null;
  return ua.id as string;
}

async function queuePayoutIfPossible(listingId: string, sellerId?: string | null, netCents?: number) {
  if (!sellerId || !netCents || netCents <= 0) return;
  const admin = getAdmin();

  const { data: seller, error: sellerErr } = await admin
    .from("mkt_profiles")
    .select("stripe_account_id")
    .eq("id", sellerId)
    .single();
  if (sellerErr) return console.error("[wh] seller fetch err:", sellerErr.message);
  if (!seller?.stripe_account_id) return;

  const when = new Date(Date.now() + 10 * 60 * 1000);
  const { error: payoutErr } = await admin.from("mkt_payouts").insert({
    listing_id: listingId,
    stripe_account_id: seller.stripe_account_id,
    amount_cents: netCents,
    scheduled_at: when.toISOString(),
    status: "pending",
  });
  if (payoutErr) console.error("[wh] payout insert err:", payoutErr.message);
  else console.log("[wh] payout queued:", listingId, netCents);
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const admin = getAdmin();
  const md = (pi.metadata ?? {}) as any;
  const listingId = md.mkt_listing_id as string | undefined;
  const buyerId   = md.mkt_buyer_id   as string | undefined;
  const sellerId  = md.mkt_seller_id  as string | undefined;

  if (!listingId || !buyerId) {
    console.warn("[wh] PI missing metadata", { listingId, buyerId, md });
    return;
  }

  const stripeId         = pi.id;
  const amountCents      = Number(pi.amount);
  const platformFeeCents = Number(pi.application_fee_amount ?? 0);
  const netCents         = Math.max(0, amountCents - platformFeeCents);

  // mark transaction completed (idempotent)
  const { data: tx1, error: tx1Err } = await admin
    .from("mkt_transactions")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("stripe_payment_id", stripeId)
    .select("id");
  if (tx1Err) console.error("[wh] tx by stripe_id error:", tx1Err.message);

  if (!tx1?.length) {
    const { error: tx2Err } = await admin
      .from("mkt_transactions")
      .update({
        status: "completed",
        stripe_payment_id: stripeId,
        updated_at: new Date().toISOString(),
      })
      .eq("listing_id", listingId)
      .eq("buyer_id", buyerId)
      .eq("status", "pending");
    if (tx2Err) console.error("[wh] tx fallback error:", tx2Err.message);
  }

  // grant read-access
  const assetId = await resolveAssetId(admin, listingId);
  if (assetId) {
    const { error: grantErr } = await admin
      .from("mkt_access_grants")
      .insert({ asset_id: assetId, grantee_id: buyerId, listing_id: listingId })
      .select("id")
      .single();
    if (grantErr && (grantErr as any).code !== "23505") {
      console.error("[wh] access grant err:", grantErr.message);
    }
  } else {
    console.warn("[wh] no asset mapped for listing", listingId);
  }

  // schedule payout
  await queuePayoutIfPossible(listingId, sellerId, netCents);
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const admin = getAdmin();
  const md = (session.metadata ?? {}) as any;
  if (md.kind !== "credits_purchase") return;

  const userId = md.userId as string | undefined;
  const credits = parseInt(md.credits ?? "0", 10);
  const amount_cents = session.amount_total ?? 0;
  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  if (!userId || !credits || credits <= 0) {
    console.warn("[wh] credits_purchase missing metadata", { userId, credits, md });
    return;
  }

  const { error: insErr } = await admin
    .from("credits_ledger")
    .insert({ user_id: userId, payment_intent: piId, amount_cents, credits, reason: "purchase" });
  if (insErr && (insErr as any).code !== "23505") {
    console.error("[wh] ledger insert err:", insErr.message);
  }

  const { error: rpcErr } = await admin.rpc("increment_profile_credits", {
    p_user_id: userId,
    p_delta: credits,
  });
  if (rpcErr) {
    console.warn("[wh] RPC missing/failed, fallback:", rpcErr.message);
    const { data: prof, error: readErr } = await admin
      .from("mkt_profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    if (readErr) {
      const { error: createErr } = await admin
        .from("mkt_profiles")
        .upsert({ id: userId, credits }, { onConflict: "id" });
      if (createErr) console.error("[wh] upsert profile failed:", createErr.message);
    } else {
      const current = Number(prof?.credits ?? 0);
      const { error: upErr } = await admin
        .from("mkt_profiles")
        .upsert({ id: userId, credits: current + credits }, { onConflict: "id" });
      if (upErr) console.error("[wh] credits upsert failed:", upErr.message);
    }
  }
}

/* ---------------- route ---------------- */
export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const sig = req.headers.get("stripe-signature") ?? "";

  const primary = process.env.STRIPE_WEBHOOK_SECRET;
  const connect = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!primary && !connect) return new NextResponse("webhook secret missing", { status: 500 });

  let event: Stripe.Event;
  try {
    if (!primary) throw new Error("skip primary");
    event = stripe.webhooks.constructEvent(rawBody, sig, primary);
  } catch (e1) {
    if (!connect) {
      console.error("[wh] bad signature (primary) & no connect:", (e1 as any)?.message);
      return new NextResponse("bad sig", { status: 400 });
    }
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, connect);
    } catch (e2) {
      console.error("[wh] bad signature (both):", (e2 as any)?.message);
      return new NextResponse("bad sig", { status: 400 });
    }
  }

  console.log("[wh] received:", event.type, "account:", (event as any).account ?? "platform");

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      // Fallback: some setups watch charge events; map back to the PI and reuse the same handler
      case "charge.succeeded": {
        const ch = event.data.object as Stripe.Charge;
        const acct = (event as any)?.account as string | undefined;
        const piId =
          typeof ch.payment_intent === "string"
            ? ch.payment_intent
            : ch.payment_intent?.id;
        if (piId) {
          const pi = await stripe.paymentIntents.retrieve(
            piId,
            acct ? { stripeAccount: acct } : undefined
          );
          await handlePaymentIntentSucceeded(pi);
        }
        break;
      }

      case "account.updated":
      case "capability.updated":
      case "account.application.authorized":
        await markSellerReadiness(event.data.object as Stripe.Account);
        break;

      default:
        // ignore
        break;
    }
  } catch (err) {
    console.error("[wh] handler error:", err);
    // Return 200 so Stripe doesn't endlessly retry, but log the error.
    // If you prefer retries, return 500 here.
  }

  // Respond after work is done (Stripe allows ~10s)
  return NextResponse.json({ received: true });
}
