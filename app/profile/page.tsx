"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useOwnedCardify } from "@/hooks/useOwnedCardify";
import NFTCard from "@/components/NFTCard";
import { WalletButton } from "@/components/WalletConnect";
import AvatarUploader from "@/components/AvatarUploader";
import {
  Pencil,
  Check,
  X,
  Sparkles,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Upload as UploadIcon,
  Plus,
  Package,
} from "lucide-react";
import { Lightbox } from "@/components/ui/lightbox";
import { CustomCardCheckoutModal } from "@/components/custom-card-checkout-modal";

const FACTORY = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}`;

// Fallback image for broken thumbnails
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#0b0f19"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6ee7ff" font-family="monospace" font-size="18">No Preview</text></svg>`
  );

type AssetRow = {
  id: string;
  owner_id: string;
  title: string | null;
  image_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
  // may or may not exist in your DB; handled gracefully
  is_ai_generation?: boolean | null;
};

type UIAsset = {
  id: string;
  owner_id: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  public_url: string;
  is_ai?: boolean;
};

const toUI = (row: AssetRow): UIAsset => {
  const file_path = row.storage_path ?? row.title ?? "";
  const file_name =
    (row.title && row.title.trim()) || file_path.split("/").pop() || "file";
  return {
    id: row.id,
    owner_id: row.owner_id,
    file_path,
    file_name,
    file_size: row.size_bytes ?? null,
    mime_type: row.mime_type ?? null,
    uploaded_at: row.created_at ?? null,
    public_url: row.image_url ?? "",
    is_ai: !!row.is_ai_generation ?? undefined,
  };
};

// inside your Profile component
type SellerBalance = {
  connected: boolean;
  stripeAccount: string | null;
  stripeBalance:
    | {
        available?: Record<string, number>;
        pending?: Record<string, number>;
      }
    | null;
  totals: Record<
    string,
    { gross: number; fee: number; net: number; net_completed: number; net_pending: number }
  >;
};

type ListingRow = {
  id: string;
  source_id: string;
  seller_id: string;
  status: "listed" | "sold" | "inactive";
  is_active: boolean;
  price_cents: number;
};

type LightboxMode = "uploads" | "generations" | "purchases";

export default function Profile() {
  const supabase = createClientComponentClient();
  const { toast } = useToast();

  const [onboarding, setOnboarding] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Uploads (manual)
  const [assets, setAssets] = useState<UIAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const PAGE_SIZE = 24;
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Generations (AI)
  const [genAssets, setGenAssets] = useState<UIAsset[]>([]);
  const [loadingGen, setLoadingGen] = useState(true);
  const [genError, setGenError] = useState<string | null>(null);
  const [offsetGen, setOffsetGen] = useState(0);
  const [hasMoreGen, setHasMoreGen] = useState(true);
  const [loadingMoreGen, setLoadingMoreGen] = useState(false);
  const [aiColumnAvailable, setAiColumnAvailable] = useState<boolean>(true); // assume yes; turn off on first query error

  const [stripeVerified, setStripeVerified] = useState<boolean | null>(null);
  const [stripeAccount, setStripeAccount] = useState<string | null>(null);

  const [sellOpen, setSellOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<UIAsset | null>(null);
  const FIXED_PRICE_USD = 9;
  const [creating, setCreating] = useState(false);

  const [listingBySource, setListingBySource] = useState<Record<string, ListingRow | undefined>>(
    {}
  );
  const [canceling, setCanceling] = useState<string | null>(null);

  const canSell = Boolean(stripeAccount && stripeVerified);
  const totalMb = useMemo(
    () => assets.reduce((s, a) => s + (a.file_size ?? 0) / (1024 * 1024), 0),
    [assets]
  );

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Profile Name
  const [displayName, setDisplayName] = useState<string>("");
  const [nameLoading, setNameLoading] = useState<boolean>(true);
  const [nameSaving, setNameSaving] = useState<boolean>(false);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [draftName, setDraftName] = useState<string>("");

  // Image-rename state
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");

  // Greeting after save
  const [greeting, setGreeting] = useState<string | null>(null);
  const greetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targetAsset, setTargetAsset] = useState<UIAsset | null>(null);
  const [isCreateDropdownOpen, setIsCreateDropdownOpen] = useState(false);

  // Lightbox state (shared)
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxMode, setLightboxMode] = useState<LightboxMode>("uploads");

  // Checkout modal state
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [selectedCardForCheckout, setSelectedCardForCheckout] = useState<UIAsset | null>(null);

  // Purchases
  const [purchases, setPurchases] = useState<UIAsset[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState<boolean>(true);
  const [sellerBal, setSellerBal] = useState<SellerBalance | null>(null);

  const openDeleteConfirm = (a: UIAsset) => {
    setTargetAsset(a);
    setConfirmOpen(true);
  };

  const openCheckoutModal = (a: UIAsset) => {
    setSelectedCardForCheckout(a);
    setCheckoutModalOpen(true);
  };

  const renameAsset = async (id: string, title: string) => {
    if (!uid) return;
    const clean = title.trim();
    if (!clean) {
      toast({
        title: "Empty name",
        description: "Provide a file name.",
        variant: "destructive",
      });
      return;
    }
    setRenamingId(id);
    const { error } = await supabase.from("user_assets").update({ title: clean }).eq("id", id);
    setRenamingId(null);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }
    // optimistic UI
    setAssets((prev) => (prev.some((x) => x.id === id) ? prev.map((a) => (a.id === id ? { ...a, file_name: clean } : a)) : prev));
    setGenAssets((prev) => (prev.some((x) => x.id === id) ? prev.map((a) => (a.id === id ? { ...a, file_name: clean } : a)) : prev));
    setRenameId(null);
    setDraftTitle("");
  };

  const confirmDelete = async () => {
    if (!targetAsset) return;
    setConfirmOpen(false);
    await deleteAsset(targetAsset);
    setTargetAsset(null);
  };

  const showGreeting = (name: string) => {
    const greetings = [
      `Hey ${name}!`,
      `Welcome back, ${name}!`,
      `Nice to see you, ${name}!`,
      `Great to have you here, ${name}!`,
    ];
    const msg = greetings[Math.floor(Math.random() * greetings.length)];
    setGreeting(msg);
    if (greetTimeoutRef.current) clearTimeout(greetTimeoutRef.current);
    greetTimeoutRef.current = setTimeout(() => setGreeting(null), 4000);
    toast({ title: msg, description: "Your profile name has been updated." });
  };

  async function fetchSellerListings(userId: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      setListingBySource({});
      return;
    }
    const { data, error } = await supabase
      .from("mkt_listings")
      .select("id, source_id, seller_id, status, is_active, price_cents")
      .eq("seller_id", userId)
      .eq("source_type", "asset")
      .in("source_id", assetIds)
      .eq("status", "listed")
      .eq("is_active", true)
      .returns<ListingRow[]>();
    if (error) {
      console.error(error);
      setListingBySource({});
      return;
    }
    const map: Record<string, ListingRow> = {};
    for (const row of data ?? []) map[row.source_id] = row;
    setListingBySource(map);
  }

  async function fetchPurchases(userId: string) {
    setLoadingPurchases(true);

    // 1) get purchased asset ids (grants)
    const { data: grants, error: gErr } = await supabase
      .from("mkt_access_grants")
      .select("asset_id")
      .eq("grantee_id", userId);

    if (gErr || !grants || grants.length === 0) {
      setPurchases([]);
      setLoadingPurchases(false);
      return;
    }

    const ids = grants.map((g) => g.asset_id).filter(Boolean);
    // 2) fetch the assets the user has grants for
    const { data: rows, error: aErr } = await supabase
      .from("user_assets")
      .select("*")
      .in("id", ids as string[])
      .order("created_at", { ascending: false });

    if (aErr) {
      setPurchases([]);
    } else {
      setPurchases((rows ?? []).map(toUI));
    }
    setLoadingPurchases(false);
  }

  useEffect(() => {
    let mounted = true;
    setLoadingAuth(true);

    supabase.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id ?? null;
      if (!mounted) return;

      if (!id) {
        setUid(null);
        setAvatarUrl(null);
        setAssets([]);
        setGenAssets([]);
        setHasMore(false);
        setHasMoreGen(false);
        setLoadingAssets(false);
        setLoadingGen(false);
        setLoadingAuth(false);
        setDisplayName("");
        setNameLoading(false);
      } else {
        setUid(id);

        // Load avatar + name + stripe
        supabase
          .from("mkt_profiles")
          .select("avatar_url, display_name, stripe_verified, stripe_account_id")
          .eq("id", id)
          .maybeSingle()
          .then(({ data: prof }) => {
            setAvatarUrl(prof?.avatar_url ?? session?.user?.user_metadata?.avatar_url ?? null);
            setDisplayName(prof?.display_name ?? "");
            setStripeVerified(!!prof?.stripe_verified);
            setStripeAccount(prof?.stripe_account_id ?? null);
            setNameLoading(false);
            setLoadingAuth(false);
          });

        fetchFirstUploadsPage(id);
        fetchFirstGenerationsPage(id);
        fetchPurchases(id);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const newId = s?.user?.id ?? null;
      if (!newId) return;

      setUid(newId);

      supabase
        .from("mkt_profiles")
        .select("avatar_url, display_name, stripe_verified, stripe_account_id")
        .eq("id", newId)
        .maybeSingle()
        .then(({ data: prof }) => {
          setAvatarUrl(prof?.avatar_url ?? null);
          setDisplayName(prof?.display_name ?? "");
          setStripeVerified(!!prof?.stripe_verified);
          setStripeAccount(prof?.stripe_account_id ?? null);
          setNameLoading(false);
        });

      fetchFirstUploadsPage(newId);
      fetchFirstGenerationsPage(newId);
      fetchPurchases(newId);
    });

    return () => {
      sub?.subscription?.unsubscribe?.();
      if (greetTimeoutRef.current) clearTimeout(greetTimeoutRef.current);
    };
  }, []);

  // ---------- data fetchers (Uploads) ----------
  async function fetchFirstUploadsPage(userId: string) {
    setLoadingAssets(true);
    setLoadError(null);

    // Prefer filtering on the DB when the column exists; otherwise fallback to client-side split.
    try {
      const { data, error } = await supabase
        .from("user_assets")
        .select("*")
        .eq("owner_id", userId)
        .eq("is_ai_generation", false)
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;

      const mapped = (data ?? []).map(toUI);
      setAssets(mapped);
      setOffset(mapped.length);
      setHasMore((data?.length ?? 0) === PAGE_SIZE);
      await fetchSellerListings(userId, mapped.map((a) => a.id));
      setAiColumnAvailable(true);
    } catch (err: any) {
      // Column likely missing — fallback: pull a single mixed page and split client-side.
      setAiColumnAvailable(false);
      const { data, error } = await supabase
        .from("user_assets")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) {
        setLoadError(error.message);
        setAssets([]);
        setHasMore(false);
      } else {
        const mapped = (data ?? []).map(toUI);
        // Put everything under uploads in fallback mode
        setAssets(mapped);
        setOffset(mapped.length);
        setHasMore((data?.length ?? 0) === PAGE_SIZE);
        await fetchSellerListings(userId, mapped.map((a) => a.id));
      }
    }

    setLoadingAssets(false);
  }

  const loadMore = useCallback(async () => {
    if (!uid || loadingMore) return;
    setLoadingMore(true);
    try {
      const from = offset,
        to = offset + PAGE_SIZE - 1;

      const q = supabase.from("user_assets").select("*").eq("owner_id", uid).order("created_at", {
        ascending: false,
      });

      const { data, error } = aiColumnAvailable
        ? await q.eq("is_ai_generation", false).range(from, to)
        : await q.range(from, to);

      if (!error) {
        const mapped = (data ?? []).map(toUI);
        setAssets((prev) => {
          const next = [...prev, ...mapped];
          fetchSellerListings(uid, next.map((a) => a.id));
          return next;
        });
        setOffset((prev) => prev + mapped.length);
        setHasMore(mapped.length === PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [uid, offset, supabase, loadingMore, aiColumnAvailable]);

  // ---------- data fetchers (Generations) ----------
  async function fetchFirstGenerationsPage(userId: string) {
    setLoadingGen(true);
    setGenError(null);

    if (!aiColumnAvailable) {
      // Column not present — hide generations section
      setGenAssets([]);
      setHasMoreGen(false);
      setLoadingGen(false);
      return;
    }

    const { data, error } = await supabase
      .from("user_assets")
      .select("*")
      .eq("owner_id", userId)
      .eq("is_ai_generation", true)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (error) {
      // any error -> behave as if no AI column
      setAiColumnAvailable(false);
      setGenAssets([]);
      setHasMoreGen(false);
    } else {
      const mapped = (data ?? []).map(toUI);
      setGenAssets(mapped);
      setOffsetGen(mapped.length);
      setHasMoreGen((data?.length ?? 0) === PAGE_SIZE);
    }
    setLoadingGen(false);
  }

  const loadMoreGen = useCallback(async () => {
    if (!uid || loadingMoreGen || !aiColumnAvailable) return;
    setLoadingMoreGen(true);
    try {
      const from = offsetGen,
        to = offsetGen + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from("user_assets")
        .select("*")
        .eq("owner_id", uid)
        .eq("is_ai_generation", true)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (!error) {
        const mapped = (data ?? []).map(toUI);
        setGenAssets((prev) => [...prev, ...mapped]);
        setOffsetGen((prev) => prev + mapped.length);
        setHasMoreGen(mapped.length === PAGE_SIZE);
      }
    } finally {
      setLoadingMoreGen(false);
    }
  }, [uid, offsetGen, supabase, loadingMoreGen, aiColumnAvailable]);

  // realtime for uploads & generations
  useEffect(() => {
    if (!uid) return;

    const ch = supabase
      .channel("user-assets-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_assets", filter: `owner_id=eq.${uid}` },
        (payload) => {
          const ui = toUI(payload.new as AssetRow);
          if (ui.is_ai && aiColumnAvailable) {
            setGenAssets((prev) => [ui, ...prev]);
          } else {
            setAssets((prev) => {
              const next = [ui, ...prev];
              fetchSellerListings(uid, next.map((a) => a.id));
              return next;
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_assets", filter: `owner_id=eq.${uid}` },
        (payload) => {
          const ui = toUI(payload.new as AssetRow);
          setAssets((prev) => (prev.some((x) => x.id === ui.id) ? prev.map((a) => (a.id === ui.id ? ui : a)) : prev));
          setGenAssets((prev) => (prev.some((x) => x.id === ui.id) ? prev.map((a) => (a.id === ui.id ? ui : a)) : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, uid, aiColumnAvailable]);

  const owned = useOwnedCardify(FACTORY);
  const nftLoading = owned.loading;
  const tokens = owned.tokens ?? [];

  const openSell = (a: UIAsset) => {
    setSelectedAsset(a);
    setSellOpen(true);
  };

  const createListing = async () => {
    if (!uid || !selectedAsset) return;
    if (!canSell) {
      toast({
        title: "Stripe account required",
        description: "Connect Stripe to list items for sale.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from("mkt_listings")
      .insert({
        title: selectedAsset.file_name,
        image_url: selectedAsset.public_url,
        price_cents: FIXED_PRICE_USD * 100,
        seller_id: uid,
        status: "listed",
        is_active: true,
        source_type: "asset",
        source_id: selectedAsset.id,
      })
      .select("id, source_id, seller_id, status, is_active, price_cents")
      .returns<ListingRow[]>();
    setCreating(false);
    if (error) {
      toast({ title: "Listing failed", description: error.message, variant: "destructive" });
      return;
    }
    const row = data?.[0];
    if (row) setListingBySource((prev) => ({ ...prev, [row.source_id]: row }));
    toast({ title: "Listed for sale", description: `${selectedAsset.file_name} • $${FIXED_PRICE_USD}.00` });
    setSellOpen(false);
    setSelectedAsset(null);
  };

  const cancelListing = async (listing: ListingRow) => {
    if (!uid) return;
    setCanceling(listing.id);
    const { error } = await supabase
      .from("mkt_listings")
      .update({ status: "inactive", is_active: false })
      .eq("id", listing.id);
    setCanceling(null);
    if (error) {
      toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
      return;
    }
    setListingBySource((prev) => {
      const next = { ...prev };
      delete next[listing.source_id];
      return next;
    });
    toast({ title: "Listing canceled" });
  };

  // Save Name (no autosave)
  const saveName = useCallback(async () => {
    if (!uid) return;
    const name = (draftName || "").trim();
    if (!name) {
      toast({
        title: "Invalid name",
        description: "Name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    if (name.length > 60) {
      toast({ title: "Too long", description: "Max 60 characters.", variant: "destructive" });
      return;
    }
    setNameSaving(true);
    const { error } = await supabase
      .from("mkt_profiles")
      .upsert({ id: uid, display_name: name }, { onConflict: "id" });
    setNameSaving(false);
    if (error) {
      toast({ title: "Name not saved", description: error.message, variant: "destructive" });
      return;
    }
    setDisplayName(name);
    setIsEditingName(false);
    showGreeting(name);
  }, [uid, draftName, supabase, toast]);

  const deleteAsset = async (a: UIAsset) => {
    if (!uid) return;
    setDeletingId(a.id);
    try {
      const res = await fetch("/api/assets/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, table: "user_assets" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        toast({
          title: "Delete failed",
          description: json?.detail || json?.error || "Try again.",
          variant: "destructive",
        });
        return;
      }
      setAssets((prev) => prev.filter((x) => x.id !== a.id));
      setGenAssets((prev) => prev.filter((x) => x.id !== a.id));
      setListingBySource((prev) => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      toast({ title: "Deleted", description: `${a.file_name} removed.` });
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/seller/balance", { cache: "no-store" });
        if (res.ok) setSellerBal(await res.json());
      } catch {}
    })();
  }, []);

  const fmt = (cents: number, cur = "USD") =>
    (cents / 100).toLocaleString(undefined, { style: "currency", currency: cur });

  // Lightbox images selector
  const lightboxImages =
    lightboxMode === "uploads"
      ? assets
      : lightboxMode === "generations"
      ? genAssets
      : purchases;

  // UI
  return (
    <div className="min-h-screen bg-cyber-black relative overflow-hidden font-mono">
      <div className="fixed inset-0 cyber-grid opacity-10 pointer-events-none" />
      <div className="fixed inset-0 scanlines opacity-20 pointer-events-none" />

      <div className="px-6 py-8 pt-24 relative max-w-7xl mx-auto">
        {/* Inline greeting banner */}
        {greeting && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyber-cyan/40 bg-cyber-dark/60 px-4 py-3 text-cyber-cyan">
            <Sparkles className="h-4 w-4" />
            <span className="font-semibold">{greeting}</span>
          </div>
        )}

        {/* Avatar + Name */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="flex items-center gap-5">
            {uid && (
              <AvatarUploader
                key={uid}
                uid={uid}
                initialUrl={avatarUrl}
                onUpdated={(url) => setAvatarUrl(url)}
                size={96}
              />
            )}

            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Name</label>

              {!isEditingName ? (
                <div className="flex items-center gap-2">
                  <button
                    className={`min-h-[40px] py-2 rounded border border-cyber-cyan/30 bg-cyber-dark/60 text-white flex items-center transition-colors ${
                      !displayName && !nameLoading
                        ? "px-4 gap-2 justify-center hover:border-cyber-cyan/50 hover:bg-cyber-dark/80 cursor-pointer"
                        : "min-w-[12rem] px-3 cursor-default"
                    }`}
                    onClick={() => {
                      if (!displayName && !nameLoading && uid) {
                        setDraftName("");
                        setIsEditingName(true);
                      }
                    }}
                    disabled={!uid || nameLoading || !!displayName}
                    title={displayName || "Click to add your name"}
                  >
                    {nameLoading ? (
                      "Loading…"
                    ) : displayName ? (
                      displayName
                    ) : (
                      <>
                        <Plus className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-400">Add your name</span>
                      </>
                    )}
                  </button>
                  {displayName && !nameLoading && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="border border-cyber-cyan/30 hover:bg-white/5"
                      onClick={() => {
                        setDraftName(displayName);
                        setIsEditingName(true);
                      }}
                      disabled={!uid}
                      aria-label="Edit name"
                      title="Edit name"
                    >
                      <Pencil className="h-4 w-4 text-white" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex items-center">
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Enter your name"
                    className="w-72 bg-cyber-dark/60 border border-cyber-cyan/30 text-white"
                    disabled={!uid}
                    autoFocus
                  />
                  <Button
                    onClick={saveName}
                    disabled={!uid || nameSaving}
                    size="icon"
                    className="border-2 border-cyber-cyan bg-cyber-dark/60 text-cyber-cyan hover:bg-cyber-cyan/10 ml-3"
                    title="Save name"
                  >
                    {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="border-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400 ml-2"
                    onClick={() => {
                      setIsEditingName(false);
                      setDraftName("");
                    }}
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {(!isEditingName && !displayName) || isEditingName ? (
                <div className="text-xs text-gray-500">
                  {!isEditingName ? "Click to add your name" : "Save or cancel your changes"}
                </div>
              ) : null}
            </div>
          </div>

          {!uid && !loadingAuth && (
            <div className="flex items-center gap-3">
              <Button
                className="cyber-button"
                onClick={async () => {
                  const origin = window.location.origin;
                  await supabase.auth.signInWithOAuth({
                    provider: "google",
                    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/profile")}` },
                  });
                }}
              >
                Sign in with Google
              </Button>
            </div>
          )}
        </div>

        {/* Earnings & Balance */}
        {uid && sellerBal && (
          <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* 1) Stripe balance */}
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-4">
                <div className="text-xs text-gray-400 mb-1">Available to withdraw</div>
                <div className="text-2xl font-bold text-white">
                  {sellerBal.stripeBalance?.available
                    ? fmt(sellerBal.stripeBalance.available.USD ?? 0, "USD")
                    : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Waiting to settle:{" "}
                  {sellerBal.stripeBalance?.pending
                    ? fmt(sellerBal.stripeBalance.pending.USD ?? 0, "USD")
                    : "—"}
                </div>
              </CardContent>
            </Card>

            {/* 2) Lifetime earnings */}
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-4">
                <div className="text-xs text-gray-400 mb-1">Total earnings</div>
                <div className="text-2xl font-bold text-white">
                  {fmt(sellerBal.totals?.USD?.net ?? 0, "USD")}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Paid so far: {fmt(sellerBal.totals?.USD?.net_completed ?? 0, "USD")}
                </div>
              </CardContent>
            </Card>

            {/* 3) Earnings on the way */}
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-4">
                <div className="text-xs text-gray-400 mb-1">Earnings on the way</div>
                <div className="text-2xl font-bold text-white">
                  {fmt(sellerBal.totals?.USD?.net_pending ?? 0, "USD")}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  From gross {fmt(sellerBal.totals?.USD?.gross ?? 0, "USD")} − platform fees{" "}
                  {fmt(sellerBal.totals?.USD?.fee ?? 0, "USD")}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Header with Create Button */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold text-white tracking-wider">
                {displayName ? `My Cards – ${displayName}` : "My Cards"}
              </h1>
              <p className="text-gray-400 mt-1">Your uploaded designs and AI generations</p>
            </div>

            {uid && !loadingAuth && (
              <div className="sm:pb-1">
                <DropdownMenu onOpenChange={setIsCreateDropdownOpen} modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button className="relative bg-cyber-black/60 border-2 text-cyber-green tracking-wider px-4 py-2 font-mono text-sm group animate-subtle-glow overflow-hidden">
                      <span className="relative z-10 pointer-events-none">CREATE NEW CARD</span>
                      <ChevronDown
                        className={`w-4 h-4 ml-2 transition-transform duration-200 pointer-events-none relative z-10 ${
                          isCreateDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyber-cyan/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="bg-cyber-black/95 backdrop-blur-md border-2 border-cyber-cyan/50 text-white min-w-[200px] mt-2 rounded-none shadow-[0_2px_8px_rgba(34,211,238,0.2)]"
                    sideOffset={5}
                  >
                    <DropdownMenuItem asChild className="focus:bg-cyber-green/20 focus:text-cyber-green cursor-pointer transition-colors duration-200">
                      <Link
                        href="/generate"
                        className="flex items-center gap-3 px-4 py-3 text-cyber-green hover:text-cyber-green font-mono text-sm"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>AI Generate</span>
                        <span className="ml-auto text-[10px] text-cyber-green/60">NEW</span>
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild className="focus:bg-cyber-pink/20 focus:text-cyber-pink cursor-pointer transition-colors duration-200">
                      <Link
                        href="/upload"
                        className="flex items-center gap-3 px-4 py-3 text-cyber-pink hover:text-cyber-pink font-mono text-sm"
                      >
                        <UploadIcon className="w-4 h-4" />
                        <span>Upload Art</span>
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>

        {/* ===================== Uploads ===================== */}
        <section className="mb-14">
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-2xl font-bold text-white tracking-wider">Uploads</h2>
            <div className="text-xs text-gray-400">
              {assets.length > 0 && (
                <span>
                  {assets.length} file{assets.length > 1 ? "s" : ""} • {totalMb.toFixed(2)} MB total
                </span>
              )}
            </div>
          </div>

          {loadingAssets ? (
            <GridSkeleton />
          ) : !uid ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">Sign in to view your uploads.</CardContent>
            </Card>
          ) : assets.length === 0 ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-center text-gray-400">
                {loadError ? (
                  <div className="text-cyber-orange">Failed to load uploads: {loadError}</div>
                ) : (
                  <>
                    No uploads found for this account.
                    <div className="text-xs text-gray-500 mt-2">
                      Active user id: <span className="text-cyber-cyan">{uid ?? "—"}</span>
                    </div>
                    <Link href="/upload" className="ml-2 text-cyber-cyan hover:text-cyber-pink underline">
                      Upload artwork
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <AssetGrid
                items={assets}
                listedById={listingBySource}
                onOpenLightbox={(index) => {
                  setLightboxMode("uploads");
                  setLightboxIndex(index);
                  setLightboxOpen(true);
                }}
                onSell={openSell}
                onDelete={openDeleteConfirm}
                onRename={(a) => {
                  setRenameId(a.id);
                  setDraftTitle(a.file_name);
                }}
                renameId={renameId}
                draftTitle={draftTitle}
                setDraftTitle={setDraftTitle}
                renamingId={renamingId}
                onRenameConfirm={renameAsset}
                cancelingId={canceling}
                onCancelListing={cancelListing}
                onBuyPhysical={openCheckoutModal}
              />

              {hasMore && (
                <div className="flex justify-center mt-6">
                  <Button onClick={loadMore} disabled={loadingMore} className="cyber-button">
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ===================== Generations ===================== */}
        {aiColumnAvailable && (
          <section className="mb-14">
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-2xl font-bold text-white tracking-wider">Generations</h2>
            </div>

            {loadingGen ? (
              <GridSkeleton />
            ) : !uid ? (
              <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
                <CardContent className="p-6 text-gray-400">Sign in to view your generations.</CardContent>
              </Card>
            ) : genAssets.length === 0 ? (
              <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
                <CardContent className="p-6 text-gray-400">
                  {genError ? `Failed to load generations: ${genError}` : "No AI generations yet."}
                </CardContent>
              </Card>
            ) : (
              <>
                <AssetGrid
                  items={genAssets}
                  listedById={listingBySource}
                  onOpenLightbox={(index) => {
                    setLightboxMode("generations");
                    setLightboxIndex(index);
                    setLightboxOpen(true);
                  }}
                  onSell={openSell}
                  onDelete={openDeleteConfirm}
                  onRename={(a) => {
                    setRenameId(a.id);
                    setDraftTitle(a.file_name);
                  }}
                  renameId={renameId}
                  draftTitle={draftTitle}
                  setDraftTitle={setDraftTitle}
                  renamingId={renamingId}
                  onRenameConfirm={renameAsset}
                  cancelingId={canceling}
                  onCancelListing={cancelListing}
                  onBuyPhysical={openCheckoutModal}
                />

                {hasMoreGen && (
                  <div className="flex justify-center mt-6">
                    <Button onClick={loadMoreGen} disabled={loadingMoreGen} className="cyber-button">
                      {loadingMoreGen ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ===================== Purchases ===================== */}
        <section className="mb-14">
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-2xl font-bold text-white tracking-wider">Purchases</h2>
          </div>

          {!uid ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">Sign in to view your purchases.</CardContent>
            </Card>
          ) : loadingPurchases ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">Loading purchases…</CardContent>
            </Card>
          ) : purchases.length === 0 ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">No purchases yet.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {purchases.map((p, index) => (
                <Card
                  key={`purchase-${p.id}`}
                  className="bg-cyber-dark/60 border border-cyber-cyan/30 hover:border-cyber-cyan/60 transition-all duration-300 overflow-hidden"
                >
                  <CardContent className="p-3">
                    <button
                      onClick={() => {
                        setLightboxMode("purchases");
                        setLightboxIndex(index);
                        setLightboxOpen(true);
                      }}
                      className="block relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-lg overflow-hidden cursor-pointer group w-full border-2 border-cyber-cyan/50 transition-all duration-300 hover:border-cyber-cyan"
                      title={p.file_name}
                    >
                      <Image
                        src={p.public_url || PLACEHOLDER}
                        alt={p.file_name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        className="object-fill"
                        onError={(e) =>
                          ((e.currentTarget as HTMLImageElement).src = PLACEHOLDER)
                        }
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-cyber-cyan text-sm font-bold tracking-wider opacity-0 group-hover:opacity-100 transition-all duration-300">
                          VIEW
                        </span>
                      </div>
                    </button>

                    <div className="mt-3">
                      <h3
                        className="text-sm font-semibold text-white truncate"
                        title={p.file_name}
                      >
                        {p.file_name}
                      </h3>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ===================== On-chain NFTs ===================== */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white tracking-wider">
              On-Chain Cardify NFTs
            </h2>
            <WalletButton />
          </div>
          {nftLoading ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">Scanning wallet…</CardContent>
            </Card>
          ) : tokens.length === 0 ? (
            <Card className="bg-cyber-dark/60 border border-cyber-cyan/30">
              <CardContent className="p-6 text-gray-400">
                Connect your wallet to see your Cardify NFTs.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {tokens.map(([collection, id]) => (
                <NFTCard
                  key={`${collection}-${id}`}
                  collection={collection as `0x${string}`}
                  id={id}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Sell dialog – price locked to $9 */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="bg-cyber-dark/95 border-2 border-cyber-cyan/50 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">
              List for Sale
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-300 break-words">
              <span className="text-xs text-gray-400 block mb-1">Item Name</span>
              <span className="text-white font-semibold">
                {selectedAsset?.file_name}
              </span>
            </div>
            <div className="border border-cyber-cyan/30 bg-cyber-cyan/5 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Fixed Price</span>
                <span className="text-2xl font-bold text-cyber-green">$9.00</span>
              </div>
            </div>
            {!canSell && (
              <div className="border border-cyber-orange/30 bg-cyber-orange/10 rounded-lg p-3 text-xs text-cyber-orange">
                Stripe not connected. Connect your account to list items.
              </div>
            )}
          </div>
          <DialogFooter className="pt-2 gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setSellOpen(false)}
              className="bg-transparent border-2 border-cyber-pink/50 text-cyber-pink hover:bg-cyber-pink/10 hover:border-cyber-pink hover:text-cyber-pink transition-all"
            >
              Close
            </Button>
            {canSell ? (
              <Button onClick={createListing} disabled={creating} className="cyber-button">
                {creating ? "Listing…" : "List for $9"}
              </Button>
            ) : (
              <Button
                onClick={async () => {
                  try {
                    setOnboarding(true);
                    const res = await fetch("/api/stripe/onboard", { method: "POST" });
                    const json = await res.json();
                    if (!res.ok || (!json?.url && !json?.dashboardUrl)) {
                      toast({
                        title: "Stripe onboarding failed",
                        description: json?.error || "Try again.",
                        variant: "destructive",
                      });
                      return;
                    }
                    window.location.href = json.url ?? json.dashboardUrl;
                  } finally {
                    setOnboarding(false);
                  }
                }}
                disabled={onboarding}
                className="cyber-button"
              >
                {onboarding ? "Opening…" : "Connect Stripe"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border border-cyber-cyan/30 bg-cyber-dark/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-cyber-orange" />
              Delete this card?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              This will remove{" "}
              <span className="text-white font-semibold">{targetAsset?.file_name}</span>{" "}
              from your profile.
            </p>
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              This action cannot be undone.
            </div>
          </div>
          <DialogFooter className="pt-2 gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className="bg-transparent border-2 border-cyber-cyan/50 text-cyber-cyan hover:bg-cyber-cyan/10 hover:border-cyber-cyan hover:text-cyber-cyan transition-all"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white border border-red-500/50"
              disabled={!!(targetAsset && deletingId === targetAsset.id)}
            >
              {targetAsset && deletingId === targetAsset.id ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox Gallery */}
      <Lightbox
        images={lightboxImages.map((a) => ({
          id: a.id,
          url: a.public_url,
          title: a.file_name,
          size: a.file_size,
          mimeType: a.mime_type,
        }))}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />

      {/* Custom Card Checkout Modal */}
      <CustomCardCheckoutModal
        isOpen={checkoutModalOpen}
        onClose={() => {
          setCheckoutModalOpen(false);
          setSelectedCardForCheckout(null);
        }}
        uploadedImage={selectedCardForCheckout?.public_url || null}
        uploadedImageUrl={selectedCardForCheckout?.public_url || null}
      />
    </div>
  );
}

/* ======================== Small helpers (pure UI) ======================== */

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="bg-cyber-dark/60 border border-cyber-cyan/30 rounded-lg p-3 animate-pulse"
        >
          <div className="relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-lg border-2 border-cyber-cyan/20" />
          <div className="mt-3 space-y-2">
            <div className="h-4 bg-cyber-cyan/10 rounded" />
            <div className="flex justify-between items-center">
              <div className="h-4 w-16 bg-cyber-green/10 rounded" />
              <div className="w-8 h-8 rounded-full bg-cyber-cyan/10" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 h-8 bg-cyber-cyan/10 rounded" />
              <div className="w-8 h-8 bg-cyber-cyan/10 rounded" />
            </div>
            <div className="h-8 bg-cyber-cyan/10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

type AssetGridProps = {
  items: UIAsset[];
  listedById: Record<string, ListingRow | undefined>;
  onOpenLightbox: (index: number) => void;
  onSell: (a: UIAsset) => void;
  onDelete: (a: UIAsset) => void;
  onBuyPhysical: (a: UIAsset) => void;
  onRename: (a: UIAsset) => void;
  onRenameConfirm: (id: string, title: string) => void;
  renameId: string | null;
  draftTitle: string;
  setDraftTitle: (s: string) => void;
  renamingId: string | null;
  cancelingId: string | null;
  onCancelListing: (listing: ListingRow) => void;
};

function AssetGrid({
  items,
  listedById,
  onOpenLightbox,
  onSell,
  onDelete,
  onBuyPhysical,
  onRename,
  onRenameConfirm,
  renameId,
  draftTitle,
  setDraftTitle,
  renamingId,
  cancelingId,
  onCancelListing,
}: AssetGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {items.map((a, index) => {
        const existing = listedById[a.id];
        const listed = !!existing && existing.is_active && existing.status === "listed";
        return (
          <Card
            key={a.id}
            className="bg-cyber-dark/60 border border-cyber-cyan/30 hover:border-cyber-cyan/60 transition-all duration-300 overflow-hidden hover:shadow-[0_0_30px_rgba(34,211,238,0.3)]"
          >
            <CardContent className="p-3">
              {/* Card frame with trading card aspect ratio - clickable */}
              <button
                onClick={() => onOpenLightbox(index)}
                className="block relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-lg overflow-hidden cursor-pointer group w-full border-2 border-cyber-cyan/50 transition-all duration-300 hover:border-cyber-cyan"
              >
                <Image
                  src={a.public_url || PLACEHOLDER}
                  alt={a.file_name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  className="object-fill"
                  priority={index < 6}
                  onError={(e) => ((e.currentTarget as HTMLImageElement).src = PLACEHOLDER)}
                />
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 bg-gradient-to-t from-cyber-dark/95 via-cyber-dark/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-cyber-cyan text-lg font-bold tracking-wider opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-90 group-hover:scale-100">
                    VIEW
                  </span>
                </div>
              </button>

              {/* Card info below */}
              <div className="mt-3 space-y-1">
                {renameId === a.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRenameConfirm(a.id, draftTitle);
                        } else if (e.key === "Escape") {
                          // cancel edit
                        }
                      }}
                      className="h-7 text-xs bg-cyber-dark/60 border-cyber-cyan/50 text-white px-2 flex-1"
                      autoFocus
                      placeholder="Enter name"
                    />
                    <Button
                      size="icon"
                      className="h-7 w-7 min-w-[1.75rem] border-2 border-cyber-cyan bg-cyber-dark/60 text-cyber-cyan hover:bg-cyber-cyan/10 flex-shrink-0"
                      onClick={() => onRenameConfirm(a.id, draftTitle)}
                      disabled={renamingId === a.id}
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      className="h-7 w-7 min-w-[1.75rem] border-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400 flex-shrink-0"
                      onClick={() => {
                        /* close handled upstream by resetting renameId */
                        const ev = new KeyboardEvent("keydown", { key: "Escape" });
                        document.dispatchEvent(ev);
                      }}
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 group/title">
                    <h3
                      className="text-sm font-semibold text-white truncate flex-1"
                      title={a.file_name}
                    >
                      {a.file_name}
                    </h3>
                    <Button
                      size="icon"
                      className="h-7 w-7 min-w-[1.75rem] border border-cyber-cyan/30 bg-cyber-dark/60 hover:bg-white/5 opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() => onRename(a)}
                      title="Rename"
                    >
                      <Pencil className="h-4 w-4 text-cyber-cyan/70" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{((a.file_size ?? 0) / (1024 * 1024)).toFixed(1)} MB</span>
                  {listed && (
                    <Badge className="bg-green-500/15 border-0 text-green-400 text-xs px-2 py-0">
                      ${((existing!.price_cents ?? 0) / 100).toFixed(0)}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 space-y-2">
                {listed ? (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onCancelListing(existing!)}
                      disabled={cancelingId === existing!.id}
                      className="w-full text-xs h-8"
                    >
                      {cancelingId === existing!.id ? "..." : "Unlist"}
                    </Button>
                    <Button
                      className="cyber-button w-full text-xs h-8"
                      size="sm"
                      onClick={() => onBuyPhysical(a)}
                    >
                      <Package className="h-3 w-3 mr-1" />
                      Buy Physical
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Button
                        className="bg-cyber-dark border-2 border-cyber-green text-cyber-green hover:bg-cyber-green/10 flex-1 text-xs h-8"
                        size="sm"
                        onClick={() => onSell(a)}
                      >
                        Sell
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="border border-red-500/30 hover:bg-red-500/10 h-8 w-8"
                        title="Delete"
                        onClick={() => onDelete(a)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                    <Button
                      className="cyber-button w-full text-xs h-8"
                      size="sm"
                      onClick={() => onBuyPhysical(a)}
                    >
                      <Package className="h-3 w-3 mr-1" />
                      Buy Physical
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
