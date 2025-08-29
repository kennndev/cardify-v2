// app/admin/page.tsx  (or app/admin/usage/page.tsx)
import { createClient } from "@supabase/supabase-js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

/* ───── Supabase (service role) ───── */
function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY!
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY")
  return createClient(url, key, { auth: { persistSession: false } })
}

/* ───── Types ───── */
type Row = {
  ts: string | null
  name: string
  user_id: string | null
  device_id: string | null
  props: Record<string, any> | null
}
type Bucket = "generate" | "upload" | "buy"

/* ───── Helpers ───── */
const DAY = 86_400_000
const last30ISO = new Date(Date.now() - 30 * DAY).toISOString()

function toDayUTC(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`
}
const fmt = (n: number) => new Intl.NumberFormat().format(n)

/* Only count terminal-state rows */
function classify(r: Row): Bucket | null {
  if (r.name === "upload") {
    if (r.props?.phase === "saved_to_supabase") return "upload"
    if (r.props?.action === "upload_ok") return "upload"
    return null
  }

  if (["buy", "checkout", "purchase"].includes(r.name)) return "buy"

  if (r.name === "generate") {
    if (r.props?.action === "done") return "generate"
    /* “upload_ok” comes through as name=generate */
    if (r.props?.action === "upload_ok") return "upload"
    return null
  }

  /* fallback on Stripe success in props.action */
  if (r.props?.action === "payment_intent_succeeded") return "buy"

  return null
}

/* ───── Page ───── */
export default async function UsageDashboard() {
  const db = getAdmin()
  const { data, error } = await db
    .from("app_events")
    .select("ts,name,user_id,device_id,props")
    .gte("ts", last30ISO)
    .order("ts", { ascending: true })
    .range(0, 50_000)

  if (error) throw new Error(`Failed to load events: ${error.message}`)

  const rows: Row[] = (data ?? []).filter((r): r is Row => !!r && typeof r.name === "string")

  /* ─ aggregates ─ */
  const agg: Record<Bucket, { t: number; u: Set<string>; d: Set<string>; last: string | null }> = {
    generate: { t: 0, u: new Set(), d: new Set(), last: null },
    upload:   { t: 0, u: new Set(), d: new Set(), last: null },
    buy:      { t: 0, u: new Set(), d: new Set(), last: null },
  }

  /* 14-day daily buckets */
  const dailyKeys = [...Array(14)]
    .map((_, i) => {
      const d = new Date(Date.now() - (13 - i) * DAY)
      return toDayUTC(d)
    })
  const daily: Record<Bucket, Record<string, number>> = {
    generate: Object.fromEntries(dailyKeys.map((k) => [k, 0])),
    upload:   Object.fromEntries(dailyKeys.map((k) => [k, 0])),
    buy:      Object.fromEntries(dailyKeys.map((k) => [k, 0])),
  }

  for (const r of rows) {
    const b = classify(r)
    if (!b) continue

    agg[b].t++
    if (r.user_id) agg[b].u.add(r.user_id)
    else if (r.device_id) agg[b].d.add(r.device_id)
    if (r.ts) agg[b].last = r.ts

    if (r.ts) {
      const key = toDayUTC(new Date(r.ts))
      if (daily[b][key] !== undefined) daily[b][key]++
    }
  }

  const cards = [
    { k: "generate", title: "Generate", sub: "AI generations" },
    { k: "upload",   title: "Upload",   sub: "File uploads" },
    { k: "buy",      title: "Buy",      sub: "Checkouts / purchases" },
  ] as const

  const last50 = rows.slice(-50).reverse()

  /* ───── UI ───── */
  return (
    <div className="min-h-screen bg-black text-white px-6 sm:px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold mb-2">Usage Dashboard</h1>
        <p className="text-sm text-gray-400 mb-8">
          Last&nbsp;30 days • Source&nbsp;<code>public.app_events</code> • UTC
        </p>

        {/* summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {cards.map(({ k, title, sub }) => (
            <Card key={k} className="bg-zinc-900 border border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-gray-400">{title}</CardTitle>
                <p className="text-xs text-gray-400">{sub}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Events</span>
                  <span className="text-2xl font-semibold text-gray-300">
                    {fmt(agg[k].t)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Unique users</span>
                  <span className="text-lg text-gray-300">
                    {fmt(agg[k].u.size)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Guest devices</span>
                  <span className="text-lg text-gray-300">
                    {fmt(agg[k].d.size)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-zinc-800">
                  <span className="text-xs text-gray-500">Last event</span>
                  <span className="text-xs text-gray-400">
                    {agg[k].last ? new Date(agg[k].last).toLocaleString() : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* daily */}
        <Card className="bg-zinc-900 border border-zinc-800">
          <CardHeader>
            <CardTitle className="text-gray-400">
              Daily totals (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-gray-400">
                  <th className="py-2 pr-4 text-left">Day</th>
                  <th className="py-2 pr-4 text-left">Generate</th>
                  <th className="py-2 pr-4 text-left">Upload</th>
                  <th className="py-2 pr-4 text-left">Buy</th>
                  <th className="py-2 pr-4 text-left">Total</th>
                </tr>
              </thead>
              <tbody>
                {dailyKeys.map((d) => {
                  const g = daily.generate[d];
                  const u = daily.upload[d];
                  const b = daily.buy[d];
                  return (
                    <tr key={d} className="border-b border-zinc-900">
                      <td className="py-2 pr-4 text-gray-300">{d}</td>
                      <td className="py-2 pr-4 text-gray-300">{g}</td>
                      <td className="py-2 pr-4 text-gray-300">{u}</td>
                      <td className="py-2 pr-4 text-gray-300">{b}</td>
                      <td className="py-2 pr-4 font-semibold text-gray-300">
                        {g + u + b}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* debug */}
        <div className="mt-8">
          <Card className="bg-zinc-900 border border-zinc-800">
            <CardHeader>
              <CardTitle className="text-base text-gray-400">
                Last 50 raw rows
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-gray-400">
                    <th className="py-2 pr-3 text-left">TS</th>
                    <th className="py-2 pr-3 text-left">Name</th>
                    <th className="py-2 pr-3 text-left">User</th>
                    <th className="py-2 pr-3 text-left">Device</th>
                    <th className="py-2 pr-3 text-left">Action/Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {last50.map((e, i) => (
                    <tr key={i} className="border-b border-zinc-900">
                      <td className="py-1 pr-3 text-gray-300">
                        {e.ts ? new Date(e.ts).toLocaleString() : "—"}
                      </td>
                      <td className="py-1 pr-3 text-gray-300">{e.name}</td>
                      <td className="py-1 pr-3 text-gray-300">
                        {e.user_id ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-gray-300">
                        {e.device_id ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-gray-300">
                        {e.props?.action ?? e.props?.phase ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          Guest devices ≈ <code>device_id</code> for logged-out users.
        </p>
      </div>
    </div>
  );
}
