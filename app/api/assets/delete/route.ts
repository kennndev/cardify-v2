import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"

// ── Admin client (service key) for Storage deletes ──
function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY")
  return createClient(url, key)
}

// Which table are you showing on the Profile page?
// Your Profile page uses `user_assets`. Your upload util writes to `uploaded_images`.
// This route supports both; pass table in body. Default to `user_assets`.
type Body = { id: string; table?: "user_assets" | "uploaded_images" }

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const { id, table = "user_assets" } = (await req.json()) as Body
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 })

    const supabase = createRouteHandlerClient({ cookies })
    const admin = getAdmin()

    // 1) Auth
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 })

    // 2) Fetch the row + verify ownership via RLS filter
    const selectCols =
      table === "user_assets"
        ? "id, owner_id, storage_path, image_url"
        : "id, user_id, storage_path, image_url"

    const { data: row, error: readErr } = await supabase
      .from(table)
      .select(selectCols)
      .eq(table === "user_assets" ? "owner_id" : "user_id", user.id)
      .eq("id", id)
      .single()

    if (readErr || !row) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const storage_path: string | null = (row as any).storage_path ?? null

    // 3) Inactivate any active marketplace listing that references this asset
    // Only hits if you list from `user_assets`. No-op if none.
    await admin
      .from("mkt_listings")
      .update({ status: "inactive", is_active: false })
      .eq("seller_id", user.id)
      .eq("source_type", "asset")
      .eq("source_id", id)
      .eq("status", "listed")

    // 4) Delete Storage object (only if we have a path)
    // Change bucket name if different (you used "custom-uploads" in your uploader)
    if (storage_path) {
      const { error: rmErr } = await admin.storage.from("custom-uploads").remove([storage_path])
      if (rmErr) {
        // If Storage fails, stop here to avoid dangling DB row claiming a file that still exists
        return NextResponse.json({ error: "storage_delete_failed", detail: rmErr.message }, { status: 500 })
      }
    }

    // 5) Delete DB row
    const { error: delErr } = await admin.from(table).delete().eq("id", id)
    if (delErr) return NextResponse.json({ error: "db_delete_failed", detail: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: "unexpected", detail: String(e?.message || e) }, { status: 500 })
  }
}
