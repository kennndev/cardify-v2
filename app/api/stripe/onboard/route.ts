import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }


    // Read profile to see if we already have a Connect account
    const { data: profile } = await supabase
      .from('mkt_profiles')
      .select('stripe_account_id, stripe_verified')
      .eq('id', user.id)
      .maybeSingle()

    const origin = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

    let accountId: string | null = profile?.stripe_account_id ?? null

    // If an account is saved, check whether onboarding is still needed
    if (accountId) {
      let account: any = null
      try {
        account = await stripe.accounts.retrieve(accountId)
      } catch {
        // saved id is stale → create fresh account below
        accountId = null
      }

      if (accountId && account) {
        const needsOnboarding =
          (account.requirements?.currently_due?.length ?? 0) > 0 ||
          !account.charges_enabled ||
          !account.payouts_enabled

        if (!needsOnboarding) {
          // Fully onboarded → give Dashboard login link
          const login = await stripe.accounts.createLoginLink(accountId, {
            redirect_url: `${origin}/profile`,
          })
          return NextResponse.json({ alreadyOnboarded: true, dashboardUrl: login.url })
        }

        // Needs more info → generate onboarding link
        const link = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: process.env.NEXT_PUBLIC_STRIPE_REFRESH_URL || `${origin}/profile`,
          return_url: process.env.NEXT_PUBLIC_STRIPE_RETURN_URL || `${origin}/profile`,
          type: 'account_onboarding',
        })
        return NextResponse.json({ alreadyOnboarded: false, url: link.url })
      }
    }

    // No valid account → create once and store (email only if present)
    const created = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: user.email ?? undefined, // Hint for Stripe; DB write is below
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { user_id: user.id },
    })
    accountId = created.id

    const patch: Record<string, any> = {
      id: user.id,
      stripe_account_id: accountId,
      stripe_verified: false,
    }
    if (user.email) patch.email = user.email

    await supabase.from('mkt_profiles').upsert(patch, { onConflict: 'id' })

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: process.env.NEXT_PUBLIC_STRIPE_REFRESH_URL || `${origin}/profile`,
      return_url: process.env.NEXT_PUBLIC_STRIPE_RETURN_URL || `${origin}/profile`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ alreadyOnboarded: false, url: link.url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unexpected error' }, { status: 500 })
  }
}
