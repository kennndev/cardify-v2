// lib/analytics-client.ts
"use client";

import { getSupabaseBrowserClient } from "./supabase-browser";

// persistent per-browser id
const DEVICE_KEY = "cardify.device_id";
const SESSION_KEY = "cardify.session_id";

function uuid() {
  // Tiny UUID v4 (good enough for client analytics)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getDeviceId(): string {
  try {
    if (typeof window === "undefined") return uuid();
    const cached = localStorage.getItem(DEVICE_KEY);
    if (cached) return cached;
    const fresh = uuid();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

function getSessionId(): string {
  try {
    if (typeof window === "undefined") return uuid();
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = uuid();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return uuid();
  }
}

type TrackResult = { ok: true } | { ok: false; error: string };

export async function track(
  name: string,
  props?: Record<string, any>
): Promise<TrackResult> {
  try {
    // client only
    if (typeof window === "undefined") return { ok: true };

    const sb = getSupabaseBrowserClient();
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id ?? null;

    // keep props JSON-safe
    const safeProps = JSON.parse(JSON.stringify(props ?? {}));

    const { error } = await sb.from("app_events").insert({
      name,
      user_id: userId,
      device_id: getDeviceId(),
      session_id: getSessionId(),
      page:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : null,
      props: safeProps,
      ua:
        typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 1024) // cap length
          : null,
    });

    if (error) {
      // visible in DevTools so you can see why nothing shows up
      console.warn("[track] insert failed:", { name, error });
      return { ok: false, error: error.message };
    }

    // helpful trace in DevTools
    if (process.env.NODE_ENV !== "production") {
      console.debug("[track]", name, safeProps);
    }

    return { ok: true };
  } catch (e: any) {
    console.warn("[track] unexpected error:", e?.message || e);
    return { ok: false, error: e?.message || "unknown_error" };
  }
}
