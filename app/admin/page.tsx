// app/admin/usage/page.tsx
import { createClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * IMPORTANT: This page runs ONLY on the server.
 * It uses the service role to bypass RLS for analytics reads.
 * Ensure SUPABASE_SERVICE_ROLE_KEY is set in your Vercel env.
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type EventRow = {
  ts: string | null;
  name: string;
  user_id: string | null;
  device_id: string | null;
  session_id: string | null;
  props: Record<string, any> | null;
};

type GroupKey = "generate" | "upload" | "buy";

const NAME_MAP: Record<string, GroupKey> = {
  generate: "generate",
  upload: "upload",
  // a few common aliases for "buy"
  buy: "buy",
  checkout: "buy",
  purchase: "buy",
  purchased: "buy",
};

function toDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

export default async function UsageDashboard() {
  const supabase = getAdminClient();

  // last 30 days window
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull only what we need, and map a few "buy" aliases to the same bucket.
  const { data, error } = await supabase
    .from("app_events")
    .select("ts,name,user_id,device_id,session_id,props")
    .gte("ts", since)
    .in("name", ["generate", "upload", "buy", "checkout", "purchase"])
    .order("ts", { ascending: true })
    .range(0, 50000); // raise if you expect >50k rows in 30d

  if (error) {
    throw new Error(`Failed to load events: ${error.message}`);
  }

  const rows: EventRow[] = (data ?? []).filter(
    (r): r is EventRow => !!r && typeof r.name === "string"
  );

  // Aggregate
  type Agg = {
    total: number;
    uniqueUsers: Set<string>; // signed-in
    uniqueDevices: Set<string>; // guests proxy
    lastAt: string | null;
  };
  const agg: Record<GroupKey, Agg> = {
    generate: { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
    upload:   { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
    buy:      { total: 0, uniqueUsers: new Set(), uniqueDevices: new Set(), lastAt: null },
  };

  // Daily series (last 14 days)
  const daysBack = 14;
  const dayKeys: string[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(toDay(d));
  }
  const daily: Record<GroupKey, Record<string, number>> = {
    generate: Object.fromEntries(dayKeys.map((d) => [d, 0])),
    upload:   Object.fromEntries(dayKeys.map((d) => [d, 0])),
    buy:      Object.fromEntries(dayKeys.map((d) => [d, 0])),
  };

  for (const r of rows) {
    const mapped = NAME_MAP[r.name] ?? null;
    if (!mapped) continue;

    agg[mapped].total += 1;
    if (r.user_id) agg[mapped].uniqueUsers.add(r.user_id);
    else if (r.device_id) agg[mapped].uniqueDevices.add(r.device_id);
    if (r.ts) agg[mapped].lastAt = r.ts;

    // daily
    if (r.ts) {
      const d = new Date(r.ts);
      const key = toDay(d);
      if (key in daily[mapped]) {
        daily[mapped][key] += 1;
      }
    }
  }

  const cards: Array<{
    key: GroupKey;
    title: string;
    subtitle: string;
  }> = [
    { key: "generate", title: "Generate", subtitle: "AI generations" },
    { key: "upload", title: "Upload", subtitle: "File uploads" },
    { key: "buy", title: "Buy", subtitle: "Checkouts / purchases" },
  ];

  return (
    <div className="min-h-screen bg-black text-white px-4 sm:px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-wide mb-2">
          Usage Dashboard
        </h1>
        <p className="text-sm text-gray-400 mb-8">
          Window: last 30 days • Data source: <code>public.app_events</code>
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {cards.map(({ key, title, subtitle }) => {
            const a = agg[key];
            return (
              <Card
                key={key}
                className="bg-zinc-900 border border-zinc-800 rounded-xl"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-white">{title}</CardTitle>
                  <p className="text-xs text-gray-400">{subtitle}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-gray-400">Events</span>
                    <span className="text-2xl font-semibold">
                      {formatNumber(a.total)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-gray-400">
                      Unique signed-in users
                    </span>
                    <span className="text-lg">
                      {formatNumber(a.uniqueUsers.size)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-gray-400">
                      Unique guest devices
                    </span>
                    <span className="text-lg">
                      {formatNumber(a.uniqueDevices.size)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between pt-1 border-t border-zinc-800">
                    <span className="text-xs text-gray-500">Last event</span>
                    <span className="text-xs text-gray-400">
                      {a.lastAt
                        ? new Date(a.lastAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Daily table (last 14 days) */}
        <Card className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <CardHeader>
            <CardTitle className="text-white">
              Daily totals (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-zinc-800">
                  <th className="py-2 pr-4">Day</th>
                  <th className="py-2 pr-4">Generate</th>
                  <th className="py-2 pr-4">Upload</th>
                  <th className="py-2 pr-4">Buy</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {dayKeys.map((d) => {
                  const g = daily.generate[d] ?? 0;
                  const u = daily.upload[d] ?? 0;
                  const b = daily.buy[d] ?? 0;
                  return (
                    <tr key={d} className="border-b border-zinc-900">
                      <td className="py-2 pr-4 text-gray-300">{d}</td>
                      <td className="py-2 pr-4">{g}</td>
                      <td className="py-2 pr-4">{u}</td>
                      <td className="py-2 pr-4">{b}</td>
                      <td className="py-2 pr-4 font-semibold">{g + u + b}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <p className="text-xs text-gray-500 mt-4">
          “Unique guest devices” uses <code>device_id</code> as a proxy for
          logged-out users. If you prefer stricter counting, switch to
          session-based or add a per-run id.
        </p>
      </div>
    </div>
  );
}
