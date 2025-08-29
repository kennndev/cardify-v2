"use client";

import { getSupabaseBrowserClient } from "./supabase-browser";

const mimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type UploadOpts = {
  metadata?: Record<string, any>; // Extra metadata like { is_ai_generation: true }
};

export async function uploadToSupabase(
  file: Blob | File,
  customPath?: string,
  opts: UploadOpts = {},
) {
  const supabase = getSupabaseBrowserClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("not_signed_in");

  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  const name = (file as File).name || "uploaded";
  const mime = (file as File).type || "application/octet-stream";
  const ext = (mimeToExt[mime] || (name.includes(".") ? name.split(".").pop()! : "bin"))
    .replace(/[^a-z0-9]/g, "");
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const safeCustom = (customPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
  const baseDir = `uploads/${userId}`;
  const storagePath = safeCustom ? `${baseDir}/${safeCustom}/${fileName}` : `${baseDir}/${fileName}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("custom-uploads")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: mime,
    });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase
    .storage
    .from("custom-uploads")
    .getPublicUrl(storagePath);

  const baseMetadata = {
    original_filename: name,
    upload_source: "custom_card_upload",
    timestamp: new Date().toISOString(),
  };

  const isAI = opts.metadata?.is_ai_generation === true;

  const payload = {
    image_url: publicUrl,
    storage_path: storagePath,
    file_size_bytes: (file as File).size ?? null,
    file_type: mime,
    user_email: userEmail,
    user_id: userId,
    metadata: {
      ...baseMetadata,
      ...(opts.metadata || {}),
      source_type: isAI ? "ai_generation" : "uploaded_image",
    },
  };

  const { data: rec, error: dbError } = await supabase
    .from("uploaded_images")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();

  // If successful, insert into user_assets
  if (rec?.id) {
    await supabase.from("user_assets").insert({
      id: crypto.randomUUID(),
      owner_id: userId,
      image_url: publicUrl,
      storage_path: storagePath,
      mime_type: mime,
      size_bytes: (file as File).size ?? null,
      created_at: new Date().toISOString(),
      source_type: isAI ? "ai_generation" : "uploaded_image",
      title: name,
    });
  }

  // Handle duplicate image (already uploaded before)
  if (dbError?.code === "23505") {
    const { data: existing } = await supabase
      .from("uploaded_images")
      .select("id")
      .eq("storage_path", storagePath)
      .single<{ id: string }>();

    // Sync to user_assets anyway
    await supabase.from("user_assets").upsert({
      id: crypto.randomUUID(),
      owner_id: userId,
      image_url: publicUrl,
      storage_path: storagePath,
      mime_type: mime,
      size_bytes: (file as File).size ?? null,
      created_at: new Date().toISOString(),
      source_type: isAI ? "ai_generation" : "uploaded_image",
      title: name,
    }, {
      onConflict: 'storage_path',
    });

    return { publicUrl, storagePath, imageRecordId: existing?.id ?? null };
  }

  // Rollback on billing error
  if (dbError) {
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

  // Fire balance update event
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
  } catch { }

  return { publicUrl, storagePath, imageRecordId: rec?.id ?? null };
}
