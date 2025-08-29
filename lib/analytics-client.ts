import { v4 as uuidv4 } from "uuid"

const KEY = "cardify.device_id"

export function getDeviceId(): string {
  if (typeof window === "undefined") return uuidv4()
  const cached = localStorage.getItem(KEY)
  if (cached) return cached
  const fresh = uuidv4()
  localStorage.setItem(KEY, fresh)
  return fresh
}

export async function track(
  event: "generate" | "upload" | "buy",
  meta?: Record<string, any>,
  status: "ok" | "error" = "ok",
  durationMs?: number
) {
  try {
    await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, status, durationMs, meta, deviceId: getDeviceId() }),
      keepalive: true, // lets it fire during navigations
    })
  } catch { /* don’t block UX on analytics */ }
}
