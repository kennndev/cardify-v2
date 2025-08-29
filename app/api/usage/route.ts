// app/api/usage/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key  = process.env.SUPABASE_SERVICE_KEY!; // DO NOT expose this to the browser

// Service-role client bypasses RLS
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      name,                         // required
      props = {},                   // optional object
      page = null,
      session_id = null,
      device_id = null,
      user_id = null,
      ts = null,                    // allow client to pass a timestamp if desired
    } = body ?? {};

    if (!name || typeof name !== "string") {
      return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
    }

    const ua = req.headers.get("user-agent") ?? null;
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;

    const { error } = await admin
      .from("app_events")
      .insert([{ name, props, page, session_id, device_id, user_id, ua, ip, ts }]);

    if (error) {
      console.error("app_events insert error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("usage route error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
