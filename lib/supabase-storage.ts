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
  /** Extra metadata to persist on uploaded_images (e.g. { is_ai_generation: true }) */
  metadata?: Record<string, any>;
};

/**
 * Upload a file → Supabase Storage → uploaded_images.
 * Handles duplicate‐key ( 23505) by returning the existing row instead of erroring.
 */
export async function uploadToSupabase(
  file: Blob | File,
  customPath?: string,
  opts: UploadOpts = {},
) {
  const supabase = getSupabaseBrowserClient();

  /* ─── auth guard ─── */
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("not_signed_in");

  const userId    = session.user.id;
  const userEmail = session.user.email ?? null;

  /* ─── build storage path ─── */
  const name  = (file as File).name || "uploaded";
  const mime  = (file as File).type || "application/octet-stream";
  const ext   = (mimeToExt[mime] || (name.includes(".") ? name.split(".").pop()! : "bin"))
                  .replace(/[^a-z0-9]/g, "");
  const fileName    = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const safeCustom  = (customPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
  const baseDir     = `uploads/${userId}`;
  const storagePath = safeCustom ? `${baseDir}/${safeCustom}/${fileName}` : `${baseDir}/${fileName}`;

  /* ─── 1) upload to storage ─── */
  const { error: uploadError } = await supabase.storage
    .from("custom-uploads")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: mime,
    });
  if (uploadError) throw uploadError;

  /* ─── public URL ─── */
  const { data: { publicUrl } } = supabase
    .storage
    .from("custom-uploads")
    .getPublicUrl(storagePath);

  /* ─── 2) insert uploaded_images (DB trigger bills the credit) ─── */
  const baseMetadata = {
    original_filename: (file as File).name || "uploaded",
    upload_source    : "custom_card_upload",
    timestamp        : new Date().toISOString(),
  };

  const isAI = opts.metadata?.is_ai_generation === true;
  const payload = {
    image_url      : publicUrl,
    storage_path   : storagePath,
    file_size_bytes: (file as File).size ?? null,
    file_type      : mime,
    user_email     : userEmail,
    user_id        : userId,
  metadata   : {
    ...baseMetadata,
    ...(opts.metadata || {}),
    source_type      : isAI ? "ai_generation" : "uploaded_image",
    ...(opts.metadata || {}),
  },
  };

  /* try normal insert first */
  const { data: rec, error: dbError } = await supabase
    .from("uploaded_images")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();

  /* ─── 3) duplicate-key guard ─── */
  if (dbError?.code === "23505") {
    // row already exists – fetch the existing record & treat as success
    const { data: existing } = await supabase
      .from("uploaded_images")
      .select("id")
      .eq("storage_path", storagePath)
      .single<{ id: string }>();

    return { publicUrl, storagePath, imageRecordId: existing?.id ?? null };
  }
  if (dbError) {
    // rollback file on known billing errors
    const msg = String(dbError.message || dbError);
    if (
      msg.includes("insufficient_credits") ||
      msg.includes("insufficient_credits_or_free_gens") ||
      msg.includes("profile_not_found")
    ) {
      await supabase.storage.from("custom-uploads")
        .remove([storagePath])
        .catch(() => {});
    }
    throw dbError;
  }

  /* ─── 4) broadcast fresh balance (best-effort) ─── */
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
        }),
      );
    }
  } catch { /* non-fatal */ }

  return { publicUrl, storagePath, imageRecordId: rec?.id ?? null };
}
