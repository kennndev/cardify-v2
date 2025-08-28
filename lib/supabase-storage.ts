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

export async function uploadToSupabase(
  file: Blob | File,
  customPath?: string,
  opts: UploadOpts = {}
) {
  const supabase = getSupabaseBrowserClient();

  // ─── auth guard ───
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("not_signed_in");

  const userId    = session.user.id;
  const userEmail = session.user.email ?? null;

  // ─── build storage path ───
  const name        = (file as File).name || "uploaded";
  const mime        = (file as File).type || "application/octet-stream";
  const ext         = (mimeToExt[mime] ||
                      (name.includes(".") ? name.split(".").pop()! : "bin"))
                      .replace(/[^a-z0-9]/g, "");
  const fileName    = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const safeCustom  = (customPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
  const baseDir     = `uploads/${userId}`;
  const storagePath = safeCustom
    ? `${baseDir}/${safeCustom}/${fileName}`
    : `${baseDir}/${fileName}`;

  // ─── 1) upload to storage ───
  const { error: uploadError } = await supabase.storage
    .from("custom-uploads")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: mime,
    });

  if (uploadError) throw uploadError;

  // ─── public URL ───
  const { data: { publicUrl } } = supabase
    .storage
    .from("custom-uploads")
    .getPublicUrl(storagePath);

  // ─── 2) insert uploaded_images (DB trigger charges or applies free-gen) ───
  const baseMetadata = {
    original_filename: (file as File).name || "uploaded",
    upload_source: "custom_card_upload",
    timestamp: new Date().toISOString(),
  };

  const payload = {
    image_url      : publicUrl,
    storage_path   : storagePath,
    file_size_bytes: (file as File).size ?? null,
    file_type      : mime,
    user_email     : userEmail,
    user_id        : userId,
    metadata       : { ...baseMetadata, ...(opts.metadata || {}) },
  };

  const { data: rec, error: dbError } = await supabase
    .from("uploaded_images")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();

  if (dbError) {
    // rollback file on known billing errors
    const msg = String(dbError.message || dbError);
    const shouldRollback =
      msg.includes("insufficient_credits") ||
      msg.includes("insufficient_credits_or_free_gens") ||
      msg.includes("profile_not_found");

    if (shouldRollback) {
      await supabase.storage.from("custom-uploads").remove([storagePath]).catch(() => {});
    }
    throw dbError;
  }

  // ─── 3) fetch fresh balance & broadcast (so Navigation updates instantly) ───
  try {
    const { data: prof } = await supabase
      .from("mkt_profiles")
      .select("credits, free_generations_used")
      .eq("id", userId)
      .maybeSingle();

    const freshCredits = Number(prof?.credits ?? 0);
    const freshFreeUsed = Number(prof?.free_generations_used ?? 0);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cardify-credits-updated", {
          detail: { credits: freshCredits, free_generations_used: freshFreeUsed },
        })
      );
    }
  } catch {
    // non-fatal if this fetch fails
  }

  return { publicUrl, storagePath, imageRecordId: rec?.id ?? null };
}
