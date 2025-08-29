/* app/(cardify)/upload/page.tsx */
"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Navigation } from "@/components/navigation"
import { UploadArea } from "@/components/upload-area"
import { FlippableCardPreview } from "@/components/flippable-card-preview"
import { CustomCardCheckoutModal } from "@/components/custom-card-checkout-modal"
import { useNavigationVisibility } from "@/hooks/use-navigation-visibility"
import { Upload, AlertCircle, ArrowRight, Sparkles, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { cropImageToAspectRatio } from "@/lib/image-processing"
import { uploadToSupabase } from "@/lib/supabase-storage"
import { getSupabaseBrowserClient, signInWithGoogle } from "@/lib/supabase-browser"
import { useToast } from "@/hooks/use-toast"
import { track } from "../../lib/analytics-client"


export default function UploadPage() {
  /* ────────────────────────────── state ────────────────────────────── */
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [processedImageBlob, setProcessedImageBlob] = useState<Blob | null>(null)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [isUploadingToDatabase, setIsUploadingToDatabase] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [uploadProgress, setUploadProgress] = useState(0)
  const [fileName, setFileName] = useState("")
  const [fileSize, setFileSize] = useState("")

  const [showCheckoutModal, setShowCheckoutModal] = useState(false)

  const [hasAgreed, setHasAgreed] = useState(false)
  const [showLegalDetails, setShowLegalDetails] = useState(false)

  const [credits, setCredits] = useState(0)
  const [user, setUser] = useState<any>(null)

  const isGuest        = !user
  const isOutOfCredits = !!user && credits <= 0

  /* ────────────────────── misc refs & helpers ──────────────────────── */
  const isNavVisible = useNavigationVisibility()
  const desktopButtonRef = useRef<HTMLDivElement>(null)
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipText, setTooltipText] = useState("")
  const { toast } = useToast()

  /* ──────────────────────── supabase session & RT ───────────────────── */
  useEffect(() => {
    const sb = getSupabaseBrowserClient()

    const init = async () => {
      const { data: { user } } = await sb.auth.getUser()
      setUser(user)
      if (!user?.id) return

      const { data } = await sb
        .from("mkt_profiles")
        .select("credits")
        .eq("id", user.id)
        .maybeSingle()

      setCredits(Number(data?.credits ?? 0))
    }
    init()

    let sub: ReturnType<typeof sb.channel> | null = null
    const listen = async () => {
      const { data: { user } } = await sb.auth.getUser()
      if (!user?.id) return

      sub = sb.channel(`credits-${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "mkt_profiles", filter: `id=eq.${user.id}` },
          payload => setCredits(Number(payload.new.credits ?? 0))
        )
        .subscribe()
    }
    listen()

    return () => { if (sub) sb.removeChannel(sub) }
  }, [])

  /* ───────────────────────── UI helpers ─────────────────────────────── */
  const getTooltipMessage = () => {
    if (isGuest)              return "Sign in to continue"
    if (isOutOfCredits)       return "No credits — buy to continue"
    if (!uploadedImage)       return "Please upload an image first"
    if (!hasAgreed)           return "☝ Agree to terms above"
    return ""
  }

  /* ───────────────────────── upload handler ─────────────────────────── */
const handleFileUpload = useCallback(async (file: File) => {
  const t0 = performance.now()
  await track("upload", {
    action: "select_file",
    name: file.name,
    size: file.size,
    type: file.type,
  })

  setIsUploading(true)
  setFileName(file.name)
  setFileSize((file.size / (1024 * 1024)).toFixed(2) + " MB")
  setUploadProgress(0)
  setUploadError(null)

  // Clear previous states
  setUploadedImageUrl(null)

  // Temporary preview while we process/upload
  const tempPreviewURL = URL.createObjectURL(file)
  setUploadedImage(tempPreviewURL)

  const prog = setInterval(() => setUploadProgress(p => (p >= 70 ? 70 : p + 10)), 200)

  try {
    // 1) Process to card aspect
    let processedBlob: Blob = file
    try {
      processedBlob = await cropImageToAspectRatio(file)
      setProcessedImageBlob(processedBlob)
      await track("upload", { phase: "cropped" })
    } catch (cropErr: any) {
      // Fallback to raw file, but record the failure of cropping
      setProcessedImageBlob(file)
      await track(
        "upload",
        { phase: "crop_failed_fallback_raw", msg: String(cropErr?.message || cropErr) },
        "error"
      )
    }

    clearInterval(prog)
    setUploadProgress(80)

    // 2) Guests: preview only (no upload/billing)
    if (isGuest) {
      setUploadProgress(100)
      await track("upload", { phase: "guest_preview_only" }, "ok", performance.now() - t0)
      setTimeout(() => setIsUploading(false), 400)
      return
    }

    // 3) Authenticated: upload and let the DB trigger bill a paid credit.
    //    IMPORTANT: Do NOT mark as AI generation here (uploads don't get free gens).
    try {
      const { publicUrl } = await uploadToSupabase(
        processedBlob,
        undefined,
        {
          /* 👇 NEW: make the row unambiguously an *upload* */
          metadata: {
            is_ai_generation: false,
            source_type:      "uploaded_image",   // <── added
          },
        },
      );

      setUploadedImageUrl(publicUrl)
      setUploadedImage(publicUrl)
      URL.revokeObjectURL(tempPreviewURL)
      setUploadProgress(100)

      await track(
        "upload",
        { phase: "saved_to_supabase", hasUrl: !!publicUrl },
        "ok",
        performance.now() - t0
      )

      // Soft refresh credits in case Realtime lags
      try {
        const sb = getSupabaseBrowserClient()
        if (user?.id) {
          const { data } = await sb
            .from("mkt_profiles")
            .select("credits")
            .eq("id", user.id)
            .maybeSingle()
          if (data) setCredits(Number(data.credits ?? 0))
        }
      } catch {
        /* non-fatal */
      }
    } catch (uploadErr: any) {
      console.error("Upload to Supabase failed:", uploadErr)
      const msg = String(uploadErr?.message || uploadErr)

      await track(
        "upload",
        { phase: "upload_error", msg },
        "error",
        performance.now() - t0
      )

      if (msg.includes("insufficient_credits") || msg.includes("insufficient_credits_or_free_gens")) {
        setUploadError("No credits remaining. Purchase credits to continue.")
        setCredits(0)
      } else if (msg === "not_signed_in") {
        // Keep the blob URL preview; user is not authenticated
      } else {
        setUploadError("Failed to upload image. Please try again.")
      }
      setUploadProgress(100)
    }
  } catch (error: any) {
    console.error("Image processing failed:", error)
    clearInterval(prog)
    await track(
      "upload",
      { phase: "processing_exception", msg: String(error?.message || error) },
      "error",
      performance.now() - t0
    )
    setUploadError("Failed to process image. Please try again.")
    setUploadProgress(100)
  } finally {
    clearInterval(prog)
    setTimeout(() => setIsUploading(false), 400)
  }
}, [isGuest, user?.id])



  /* ───────────────────── finalize / buy / sign-in ───────────────────── */
// ensure you have: import { track } from "@/lib/analytics-client"

const finishOrRedirect = async (): Promise<void> => {
  const t0 = performance.now();

  // block if required state missing
  if (!uploadedImage || !hasAgreed) {
    await track("upload", {
      phase: "finalize_block",
      reason: !uploadedImage ? "no_image" : "not_agreed",
      level: "warn", // label it in props, not in the status slot
    });
    return;
  }

  // auth gate
  if (isGuest) {
    await track("upload", { phase: "finalize_gate_guest" });
    toast({ title: "Sign in required" });
    signInWithGoogle("/upload");
    return;
  }

  // credits gate
  if (isOutOfCredits) {
    await track("upload", { phase: "finalize_gate_no_credits" });
    toast({ title: "No credits", description: "Buy credits to continue." });
    window.location.href = "/credits";
    return;
  }

  // already uploaded? open checkout
  if (uploadedImageUrl) {
    await track("upload", {
      phase: "open_checkout",
      from: "existing_url",
      duration_ms: performance.now() - t0,
    });
    await track("buy", { event: "open_checkout", source: "upload_finalize_existing" });
    setShowCheckoutModal(true);
    return;
  }

  // upload now, then open checkout
  setIsUploadingToDatabase(true);
  setUploadError(null);

  try {
    // Make the blob definitively a Blob (not null)
    const blob: Blob = processedImageBlob
      ? processedImageBlob
      : await fetch(uploadedImage as string).then((r) => r.blob());

    const { publicUrl } = await uploadToSupabase(
      blob,
      undefined,
      {
        /* 👇 SAME one-liner here */
        metadata: {
          is_ai_generation: false,
          source_type:      "uploaded_image",   // <── added
        },
      },
    );

    await track("upload", {
      phase: "uploading_from_finalize",
      size: blob.size,
      type: blob.type,
    });

    setUploadedImageUrl(publicUrl);
    setUploadedImage(publicUrl);
    setShowCheckoutModal(true);

    await track("upload", {
      phase: "uploaded_from_finalize",
      hasUrl: !!publicUrl,
      duration_ms: performance.now() - t0,
    });
    await track("buy", { event: "open_checkout", source: "upload_finalize_uploaded" });
  } catch (err: any) {
    const msg = String(err?.message || err);
    await track("upload", { phase: "finalize_upload_error", msg }, "error");

    if (err?.message === "no_credits") {
      setUploadError("No credits remaining. Purchase credits to continue.");
    } else {
      setUploadError("Failed to upload image. Try again.");
    }
  } finally {
    setIsUploadingToDatabase(false);
  }
};


  /* ─────────────────────────── tooltips ─────────────────────────────── */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseEnter = useCallback(() => {
    const message = getTooltipMessage()
    if (!message || isUploadingToDatabase) return
    
    // Clear any existing timeout
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }
    
    setTooltipText(message)
    setShowTooltip(true)
    // Small delay for smooth fade in
    setTimeout(() => {
      setTooltipVisible(true)
    }, 10)
    
    document.addEventListener('mousemove', handleMouseMove)
  }, [uploadedImage, hasAgreed, isGuest, isOutOfCredits, isUploadingToDatabase, handleMouseMove])

  const handleMouseLeave = useCallback(() => {
    // Start fade out
    setTooltipVisible(false)
    
    // Remove tooltip after fade animation completes
    tooltipTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false)
      setTooltipText("")
    }, 150) // Match the transition duration
    
    document.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])
  
  // Clean up tooltip on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
      document.removeEventListener("mousemove", handleMouseMove)
    }
  }, [handleMouseMove])
  
  // Clean up blob URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clean up blob URL when component unmounts
      if (uploadedImage && uploadedImage.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedImage)
      }
    }
  }, [uploadedImage])

  /* ───────────────────────── action button ──────────────────────────── */
  const ActionButton = () => (
    <Button
      disabled={!uploadedImage || !hasAgreed || isUploadingToDatabase}
      onClick={finishOrRedirect}
      className={`w-full text-lg py-6 tracking-wider transition-all duration-300 ${
        uploadedImage && hasAgreed
          ? "cyber-button"
          : "bg-gray-800 border-2 border-gray-600 text-gray-500 cursor-not-allowed opacity-50"
      }`}
    >
      {isUploadingToDatabase ? (
        <>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Uploading…
        </>
      ) : isGuest ? (
        <>Sign In</>
      ) : isOutOfCredits ? (
        <>Buy Credits</>
      ) : (
        <>
          Finalize <ArrowRight className="w-5 h-5 ml-2" />
        </>
      )}
    </Button>
  )


  /* ─────────────────────────────── JSX ──────────────────────────────── */
  return (
    <div className="min-h-screen bg-cyber-black relative overflow-hidden font-mono">
      <div className="fixed inset-0 cyber-grid opacity-10 pointer-events-none" />
      <div className="fixed inset-0 scanlines opacity-20 pointer-events-none" />

      <Navigation />

      <CustomCardCheckoutModal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        uploadedImage={uploadedImage}
        processedImageBlob={processedImageBlob}
        uploadedImageUrl={uploadedImageUrl}
      />

      <div className="px-6 py-8 pt-24">
        <div className="max-w-7xl mx-auto">
          {/* heading */}
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wider">
              Upload Your Own Artwork
            </h1>
            <p className="text-gray-400">Create custom trading cards with your own designs</p>
          </div>

          <div className="grid lg:grid-cols-5 gap-8">
            {/* left column */}
            <div className="lg:col-span-3 flex flex-col gap-3">
              {/* upload card */}
<Card className="bg-cyber-dark/60 backdrop-blur-sm border border-cyber-cyan/30 flex-1 flex flex-col">
  <CardHeader className="pb-3">
    <CardTitle className="text-white flex items-center gap-2 tracking-wider text-lg">
      <Upload className="w-5 h-5 text-cyber-cyan" /> Upload Artwork
    </CardTitle>
    <p className="text-xs text-gray-400 mt-1.5 ml-7">
      Need artwork? Try Canva or Photoshop (1200×1680 px+) or our{" "}
      <a
        href="/generate"
        className="text-cyber-cyan underline hover:text-cyber-pink transition-colors"
      >
        AI Generator
      </a>
      .
    </p>

    {/* Credit notice (always shown) */}
    <div className="mt-2 ml-7 flex items-start gap-2 text-[11px] bg-cyber-orange/10 border border-cyber-orange/40 rounded px-2 py-1.5">
      <AlertCircle className="w-3.5 h-3.5 text-cyber-orange mt-0.5" />
      <span className="text-gray-300">
        Choosing a file will immediately save it and deduct{" "}
        <span className="font-semibold text-cyber-orange">1 credit</span> — choose wisely.
      </span>
    </div>
  </CardHeader>

  <CardContent className="flex-1 flex flex-col pt-3">
    <UploadArea
      onFileUpload={handleFileUpload}
      disabled={isUploading}
      isUploading={isUploading}
      uploadProgress={uploadProgress}
      fileName={fileName}
      fileSize={fileSize}
      uploadedImage={uploadedImage}
    />
  </CardContent>
</Card>


              {/* mobile preview */}
              <div className="lg:hidden">
                <Card className="bg-cyber-dark/60 backdrop-blur-sm border border-cyber-cyan/30">
                  <CardHeader>
                    <CardTitle className="text-white tracking-wider">Card Preview</CardTitle>
                    <p className="text-gray-400 text-sm">Hover to see the back of your card</p>
                  </CardHeader>
                  <CardContent>
                    <FlippableCardPreview 
                      artwork={uploadedImageUrl || (isUploading ? null : uploadedImage)} 
                      defaultImage="/example-card_cardify.webp"
                      isLoading={isUploading || (!!uploadedImage && !uploadedImageUrl && !isGuest)}
                       useSimpleLoader={true}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* desktop action */}
              <Card className="bg-cyber-dark/60 backdrop-blur-sm border border-cyber-green/30 hidden lg:block">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* legal checkbox */}
                    <label className="flex items-start gap-2 cursor-pointer">
                      <Checkbox
                        checked={hasAgreed}
                        onCheckedChange={v => setHasAgreed(v as boolean)}
                        className="h-4 w-4 mt-0.5 border-2 border-cyber-cyan data-[state=checked]:bg-cyber-cyan data-[state=checked]:border-cyber-cyan data-[state=checked]:text-cyber-black"
                      />
                      <span className="text-xs text-gray-300 leading-relaxed">
                        I confirm I have rights to use this content and agree to the{" "}
                        <a href="/terms" target="_blank" className="text-cyber-cyan underline">
                          Terms
                        </a>{" "}
                        and{" "}
                        <a href="/dmca" target="_blank" className="text-cyber-cyan underline">
                          DMCA Policy
                        </a>
                        .{" "}
                        <button
                          type="button"
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            setShowLegalDetails(v => !v)
                          }}
                          className="text-gray-400 ml-0.5 text-[11px] border border-gray-600 px-1.5 py-0.5 rounded"
                        >
                          {showLegalDetails ? "− less" : "+ more"}
                        </button>
                      </span>
                    </label>
                    {showLegalDetails && (
                      <div className="text-xs text-gray-400 bg-cyber-dark/50 p-2 rounded border border-cyber-cyan/10">
                        <p className="flex items-start gap-1 mb-1">
                          <span className="text-cyber-yellow">•</span> You own or have licenses to use
                          all content
                        </p>
                        <p className="flex items-start gap-1 mb-1">
                          <span className="text-cyber-yellow">•</span> Content doesn’t infringe IP
                        </p>
                        <p className="flex items-start gap-1">
                          <span className="text-cyber-yellow">•</span> No unauthorized likenesses
                        </p>
                      </div>
                    )}

                    {/* button */}
                    <div 
                      ref={desktopButtonRef} 
                      className="pt-1"
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    >
                      <ActionButton />
                    </div>

                    {uploadError && (
                      <div className="text-xs text-red-400 bg-red-900/20 border border-red-400/30 rounded p-2 mt-2">
                        <AlertCircle className="w-3 h-3 inline mr-1" /> {uploadError}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* right column preview */}
            <div className="hidden lg:block lg:col-span-2">
              <div
                className={`sticky transition-all duration-300 ${
                  isNavVisible ? "top-24" : "top-4"
                }`}
              >
                <Card className="bg-cyber-dark/60 backdrop-blur-sm border border-cyber-cyan/30">
                  <CardHeader>
                    <CardTitle className="text-white tracking-wider">Card Preview</CardTitle>
                    <p className="text-gray-400 text-sm">Hover to see the back of your card</p>
                  </CardHeader>
                  <CardContent>
                <FlippableCardPreview
artwork={uploadedImageUrl || (isUploading ? null : uploadedImage)}
  defaultImage="/example-card_cardify.webp"
  isLoading={isUploading || (!!uploadedImage && !uploadedImageUrl && !isGuest)}
  useSimpleLoader
/>

                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* mobile action */}
          <Card className="bg-cyber-dark/60 backdrop-blur-sm border border-cyber-green/30 lg:hidden mt-8">
            <CardContent className="p-6 space-y-4">
              {/* legal checkbox */}
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={hasAgreed}
                  onCheckedChange={v => setHasAgreed(v as boolean)}
                  className="h-4 w-4 mt-0.5 border-2 border-cyber-cyan data-[state=checked]:bg-cyber-cyan data-[state=checked]:border-cyber-cyan data-[state=checked]:text-cyber-black"
                />
                <span className="text-xs text-gray-300 leading-relaxed">
                  I confirm I have rights to use this content and agree to the{" "}
                  <a href="/terms" target="_blank" className="text-cyber-cyan underline">
                    Terms
                  </a>{" "}
                  and{" "}
                  <a href="/dmca" target="_blank" className="text-cyber-cyan underline">
                    DMCA Policy
                  </a>
                  .{" "}
                  <button
                    type="button"
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setShowLegalDetails(v => !v)
                    }}
                    className="text-gray-400 ml-0.5 text-[11px] border border-gray-600 px-1.5 py-0.5 rounded"
                  >
                    {showLegalDetails ? "− less" : "+ more"}
                  </button>
                </span>
              </label>
              {showLegalDetails && (
                <div className="text-xs text-gray-400 bg-cyber-dark/50 p-2 rounded border border-cyber-cyan/10">
                  <p className="flex items-start gap-1 mb-1">
                    <span className="text-cyber-yellow">•</span> You own or have licenses to use
                    all content
                  </p>
                  <p className="flex items-start gap-1 mb-1">
                    <span className="text-cyber-yellow">•</span> Content doesn't infringe IP
                  </p>
                  <p className="flex items-start gap-1">
                    <span className="text-cyber-yellow">•</span> No unauthorized likenesses
                  </p>
                </div>
              )}
              
              <div 
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <ActionButton />
              </div>
              {uploadError && (
                <div className="text-xs text-red-400 bg-red-900/20 border border-red-400/30 rounded p-2">
                  <AlertCircle className="w-3 h-3 inline mr-1" /> {uploadError}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="px-6 py-8 mt-16 border-t border-cyber-cyan/20 bg-cyber-dark/40">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm text-gray-400">
            © {new Date().getFullYear()} Cardify. All rights reserved.
          </p>
        </div>
      </footer>

      {/* tooltip */}
      {showTooltip && tooltipText && (
        <div
          className={`fixed z-50 pointer-events-none transition-opacity duration-150 ${
            tooltipVisible ? "opacity-100" : "opacity-0"
          }`}
          style={{ left: mousePos.x + 15, top: mousePos.y + 15 }}
        >
          <div className="bg-cyber-dark border border-cyber-cyan/50 text-white text-sm px-3 py-2 rounded-md shadow-lg max-w-xs">
            {tooltipText}
          </div>
        </div>
      )}
    </div>
  )
}
