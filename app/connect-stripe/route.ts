// app/api/stripe/connect/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { stripe } from "@/lib/stripe"

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  // Resolve base URL from env or request
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/+$/, "")

  if (!user) {
    return NextResponse.redirect(new URL("/auth/signin", baseUrl))
  }

  const userId = user.id

  // Already connected?
  const { data: profile } = await supabase
    .from("mkt_profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle()

  if (profile?.stripe_account_id) {
    return NextResponse.redirect(new URL("/profile", baseUrl))
  }

  // Create a Connect Express account
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email: user.email ?? undefined,
    capabilities: {
      transfers: { requested: true },
    },
  })

  // Persist account id
  const { error: updateErr } = await supabase
    .from("mkt_profiles")
    .update({ stripe_account_id: account.id })
    .eq("id", userId)

  if (updateErr) {
    return NextResponse.redirect(new URL("/profile?error=stripe-account-store-failed", baseUrl))
  }

  // Create onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${baseUrl}/profile?stripe=reauth`,
    return_url: `${baseUrl}/profile?stripe=connected`,
    type: "account_onboarding",
  })

  return NextResponse.redirect(accountLink.url)
}
