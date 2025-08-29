// lib/analytics-client.ts
const DEVICE_STORAGE_KEY = "cardify.device_id";

function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (!id) {
    id = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }
  return id;
}

// Add the page ref automatically if available (helps debugging)
const guessPage = () =>
  typeof window !== "undefined" ? window.location.pathname : null;

export type EventName = "generate" | "upload" | "buy" | "view" | "checkout_open" | "checkout_done";
export type EventProps = Record<string, unknown>;

/** Fire-and-forget client analytics */
export async function track(name: EventName, props: EventProps = {}): Promise<void> {
  try {
    await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // allows send on unload
      body: JSON.stringify({
        name,
        props,
        device_id: getDeviceId(),
        page: guessPage(),
      }),
    });
  } catch {
    // never throw from analytics
  }
}
