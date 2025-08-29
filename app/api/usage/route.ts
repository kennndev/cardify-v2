import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service role, server-only
)

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { event, status = "ok", durationMs, meta = {}, deviceId } = body ?? {}

    if (!event) return NextResponse.json({ error: "missing event" }, { status: 400 })

    // get user (if signed in)
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()

    // keep meta small & safe
    const metaSafe = {
      ...meta,
      ref: req.headers.get("referer") || undefined,
    }

    await admin.from("function_usage_events").insert({
      function: event,                       // e.g. "generate", "upload", "buy"
      route: new URL(req.url).pathname,      // "/api/usage"
      status,                                 // "ok" | "error"
      duration_ms: durationMs ?? null,
      user_id: user?.id ?? null,
      anon_id: deviceId ?? null,
      http_status: 200,
      meta: metaSafe,
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fail" }, { status: 500 })
  } finally {
    // (optional) you could also measure endpoint time here
  }
}
