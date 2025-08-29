// app/api/usage/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY; // optional; use if you prefer bypassing RLS

const supabase = createClient(SUPABASE_URL, SERVICE ?? ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type Body = {
  name?: string;
  props?: Record<string, unknown>;
  user_id?: string | null;
  device_id?: string | null;
  session_id?: string | null;
  page?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !(SERVICE || ANON)) {
      console.error("Missing Supabase env");
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const body = (await req.json()) as Body;
    if (!body?.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.ip ??
      null;
    const ua = req.headers.get("user-agent") ?? null;

    const { error, data } = await supabase
      .from("app_events")
      .insert({
        name: body.name,
        props: body.props ?? {},
        user_id: body.user_id ?? null,
        device_id: body.device_id ?? null,
        session_id: body.session_id ?? null,
        page: body.page ?? req.headers.get("referer") ?? null,
        ua,
        ip,
      })
      .select("id")
      .single();

    if (error) {
      console.error("app_events insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (e: any) {
    console.error("usage route exception:", e);
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
