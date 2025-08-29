// app/admin/page.tsx  (or app/admin/usage/page.tsx)
import { createClient } from "@supabase/supabase-js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

/* ──────────────────────────────────────────────── */
/* Supabase (service-role – read-only bypass RLS)   */
/* ──────────────────────────────────────────────── */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY!
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY")
  return createClient(url, key, { auth: { persistSession: false } })
}

/* ──────────────────────────────────────────────── */
/* Types                                           */
/* ──────────────────────────────────────────────── */
type EventRow = {
  ts: string | null
  name: string
  user_id: string | null
  device_id: string | null
  session_id: string | null
  props: Record<string, any> | null
}

type GroupKey = "generate" | "upload" | "buy"

/* ──────────────────────────────────────────────── */
/* Helper utils                                    */
/* ──────────────────────────────────────────────── */
function toDayUTC(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function fmt(n: number) {
  return new Intl.NumberFormat().format(n)
}

/* Map each row → bucket */
function classify(r: EventRow): GroupKey | null {
  /* direct name match */
  if (r.name === "generate") return "generate"
  if (r.name === "upload")   return "upload"
  if (["buy", "checkout", "purchase", "purchased"].includes(r.name)) return "buy"

  /* fallback to props.action */
  const a = r.props?.action ?? ""
  if (a.startsWith("upload_") || a === "cropped") return "upload"
  if (["checkout", "payment_intent_succeeded", "purchased", "purchase"].includes(a))
    return "buy"
  if (a) return "generate"

  return null
}

/* ──────────────────────────────────────────────── */
/* Main page                                       */
/* ──────────────────────────────────────────────── */
export default async function UsageDashboard() {
  const db = getAdminClient()

  /* last 30 days */
  const sinceISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from("app_events")
    .select("ts,name,user_id,device_id,session_id,props")
    .gte("ts", sinceISO)
    .order("ts", { ascending: true })
    .range(0, 50000)

  if (error) throw new Error(`Failed to load events: ${error.message}`)

  const rows: EventRow[] = (data ?? []).filter(
    (r): r is EventRow => r && typeof r.name === "string"
  )

  /* ---------- aggregate ---------- */
  type Agg = {
    total: number
    uniqueUsers: Set<string>
    uniqueDevices: Set<string>
    lastAt: string | null
  }
  const agg: Record<GroupKey, Agg> = {
    generate: { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
    upload:   { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
    buy:      { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
  }

  /* ---------- daily buckets (14 days) ---------- */
  const dayKeys: string[] = []
  const daysBack = 14
  const base = new Date()
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() - i)
    dayKeys.push(toDayUTC(d))
  }
  const daily: Record<GroupKey, Record<string, number>> = {
    generate: Object.fromEntries(dayKeys.map((d) => [d, 0])),
    upload:   Object.fromEntries(dayKeys.map((d) => [d, 0])),
    buy:      Object.fromEntries(dayKeys.map((d) => [d, 0])),
  }

  /* crunch */
  for (const r of rows) {
    const bucket = classify(r)
    if (!bucket) continue

    agg[bucket].total++
    if (r.user_id)   agg[bucket].uniqueUsers.add(r.user_id)
    else if (r.device_id) agg[bucket].uniqueDevices.add(r.device_id)
    if (r.ts)        agg[bucket].lastAt = r.ts

    if (r.ts) {
      const k = toDayUTC(new Date(r.ts))
      if (daily[bucket][k] !== undefined) daily[bucket][k]++
    }
  }

  const cards: { key: GroupKey; title: string; subtitle: string }[] = [
    { key: "generate", title: "Generate", subtitle: "AI generations" },
    { key: "upload",   title: "Upload",   subtitle: "File uploads" },
    { key: "buy",      title: "Buy",      subtitle: "Checkouts / purchases" },
  ]

  const last50 = [...rows].slice(-50).reverse()

  /* ───────────────────────────── UI ───────────────────────────── */
  return (
    <div className="min-h-screen bg-black text-white px-4 sm:px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold tracking-wide mb-2">Usage Dashboard</h1>
        <p className="text-sm text-gray-400 mb-8">
          Window: last&nbsp;30 days • Source: <code>public.app_events</code> • UTC
        </p>

        {/* summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {cards.map(({ key, title, subtitle }) => {
            const a = agg[key]
            return (
              <Card key={key} className="bg-zinc-900 border border-zinc-800 rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle>{title}</CardTitle>
                  <p className="text-xs text-gray-400">{subtitle}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Events</span>
                    <span className="text-2xl font-semibold">{fmt(a.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Unique signed-in users</span>
                    <span className="text-lg">{fmt(a.uniqueUsers.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Unique guest devices</span>
                    <span className="text-lg">{fmt(a.uniqueDevices.size)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-zinc-800">
                    <span className="text-xs text-gray-500">Last event</span>
                    <span className="text-xs text-gray-400">
                      {a.lastAt ? new Date(a.lastAt).toLocaleString() : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* daily table */}
        <Card className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <CardHeader>
            <CardTitle>Daily totals (last 14 days)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-4 text-left text-gray-400">Day (UTC)</th>
                  <th className="py-2 pr-4 text-left text-gray-400">Generate</th>
                  <th className="py-2 pr-4 text-left text-gray-400">Upload</th>
                  <th className="py-2 pr-4 text-left text-gray-400">Buy</th>
                  <th className="py-2 pr-4 text-left text-gray-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {dayKeys.map((d) => {
                  const g = daily.generate[d]
                  const u = daily.upload[d]
                  const b = daily.buy[d]
                  return (
                    <tr key={d} className="border-b border-zinc-900">
                      <td className="py-2 pr-4 text-gray-300">{d}</td>
                      <td className="py-2 pr-4">{g}</td>
                      <td className="py-2 pr-4">{u}</td>
                      <td className="py-2 pr-4">{b}</td>
                      <td className="py-2 pr-4 font-semibold">{g + u + b}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* debug: last 50 */}
        <div className="mt-8">
          <Card className="bg-zinc-900 border border-zinc-800 rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">Last 50 events (debug)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-gray-400">
                    <th className="py-2 pr-3 text-left">TS</th>
                    <th className="py-2 pr-3 text-left">Name</th>
                    <th className="py-2 pr-3 text-left">User</th>
                    <th className="py-2 pr-3 text-left">Device</th>
                    <th className="py-2 pr-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {last50.map((e, i) => (
                    <tr key={i} className="border-b border-zinc-900">
                      <td className="py-1 pr-3 text-gray-300">
                        {e.ts ? new Date(e.ts).toLocaleString() : "—"}
                      </td>
                      <td className="py-1 pr-3">{e.name}</td>
                      <td className="py-1 pr-3">{e.user_id ?? "—"}</td>
                      <td className="py-1 pr-3">{e.device_id ?? "—"}</td>
                      <td className="py-1 pr-3">
                        {e.props?.action ?? Object.keys(e.props ?? {})[0] ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          “Unique guest devices” uses <code>device_id</code> as a proxy for logged-out users.
        </p>
      </div>
    </div>
  )
}
