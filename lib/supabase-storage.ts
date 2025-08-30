"use client";

import { getSupabaseBrowserClient } from "./supabase-browser";

const mimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
};

type UploadOpts = {
  /** Extra metadata merged into uploaded_images.metadata (e.g. { is_ai_generation: true }) */
  metadata?: Record<string, any>;
};

export type UploadResult = {
  publicUrl: string;
  storagePath: string;
  imageRecordId: string | null;
};

/**
 * Upload → Storage (`custom-uploads`) → insert into `uploaded_images`.
 * The DB trigger mirrors into `user_assets`, so the client must NOT write user_assets.
 */
export async function uploadToSupabase(
  file: Blob | File,
  customPath?: string,
  opts: UploadOpts = {}
): Promise<UploadResult> {
  const supabase = getSupabaseBrowserClient();

  // ── auth guard ──
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("not_signed_in");

  const userId    = session.user.id;
  const userEmail = session.user.email ?? null;

  // ── build storage path ──
  const srcFile = file as File;
  const name = srcFile.name || "uploaded";
  const mime = srcFile.type || "application/octet-stream";
  const extFromMime = mimeToExt[mime];
  const ext = (extFromMime || (name.includes(".") ? name.split(".").pop()! : "bin"))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const fileName   = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const safeCustom = (customPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
  const baseDir    = `uploads/${userId}`;
  const storagePath = safeCustom ? `${baseDir}/${safeCustom}/${fileName}` : `${baseDir}/${fileName}`;

  // ── 1) upload to storage ──
  const { error: uploadError } = await supabase.storage
    .from("custom-uploads")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: mime,
    });

  if (uploadError) {
    // If object already exists, surface as normal error — the row insert handles dedupe.
    throw uploadError;
  }

  // ── public URL ──
  const { data: { publicUrl } } = supabase
    .storage
    .from("custom-uploads")
    .getPublicUrl(storagePath);

  // ── 2) insert uploaded_images (trigger mirrors into user_assets) ──
  const payload = {
    image_url      : publicUrl,
    storage_path   : storagePath,
    file_size_bytes: srcFile.size ?? null,
    file_type      : mime,
    user_email     : userEmail,
    user_id        : userId,
    metadata       : {
      original_filename: name,
      upload_source    : "custom_card_upload",
      timestamp        : new Date().toISOString(),
      // mark AI generations explicitly if you pass it in opts
      is_ai_generation : !!opts.metadata?.is_ai_generation,
      ...(opts.metadata || {}),
    },
  };

const { data: rec, error: dbError } = await supabase
  .from("uploaded_images")
  .insert(payload)
  .select("id")
  .single<{ id: string }>();

  // ── 3) duplicate-key guard (e.g., unique storage_path) ──
  if (dbError && dbError.code === "23505") {
    // Fetch the existing row safely (no 406 on 0 rows)
const { data: existing } = await supabase
  .from("uploaded_images")
  .select("id")
  .eq("storage_path", storagePath)
  .maybeSingle<{ id: string }>();
    return { publicUrl, storagePath, imageRecordId: existing?.id ?? null };
  }

  // Other DB errors: optionally clean up the storage object on known billing failures
  if (dbError) {
    const msg = String(dbError.message || dbError);
    if (
      msg.includes("insufficient_credits") ||
      msg.includes("insufficient_credits_or_free_gens") ||
      msg.includes("profile_not_found") ||
      msg.includes("missing_user_id")
    ) {
      // best-effort rollback
      await supabase.storage.from("custom-uploads").remove([storagePath]).catch(() => {});
    }
    throw dbError;
  }

  // ── 4) broadcast fresh balance (best-effort) ──
  try {
    const { data: prof } = await supabase
      .from("mkt_profiles")
      .select("credits, free_generations_used")
      .eq("id", userId)
      .maybeSingle();

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cardify-credits-updated", {
          detail: {
            credits: Number(prof?.credits ?? 0),
            free_generations_used: Number(prof?.free_generations_used ?? 0),
          },
        })
      );
    }
  } catch {
    // non-fatal
  }

  return { publicUrl, storagePath, imageRecordId: rec?.id ?? null };
}
