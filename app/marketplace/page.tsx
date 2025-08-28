'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Search, User as UserIcon, ChevronLeft, ChevronRight } from "lucide-react"

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { signInWithGoogle } from '@/lib/supabase-browser'

type ListingRow = {
  id: string
  title: string
  description: string | null
  image_url: string | null
  price_cents: number
  currency: string
  seller_id: string
  buyer_id: string | null
  status: 'listed' | 'sold' | 'inactive'
  is_active: boolean
  created_at: string | null
}

type SellerMeta = {
  id: string
  display_name: string | null
  avatar_url: string | null
}

/* ───────────────────────── helpers ───────────────────────── */

const dollars = (cents: number) => (cents / 100).toFixed(2)

const initials = (name?: string | null) => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?'
}

/* ───────────────────────── card ───────────────────────── */

function MarketplaceCard({
  listing,
  currentUserId,
  seller,
  onCancel,
  onBuy,
  onView,
}: {
  listing: ListingRow
  currentUserId: string | null
  seller?: SellerMeta
  onCancel: (l: ListingRow) => Promise<void>
  onBuy: (l: ListingRow) => void
  onView: (l: ListingRow) => void
}) {
  const isSoldOrInactive = listing.status !== 'listed' || !listing.is_active
  const isSeller = !!currentUserId && currentUserId === listing.seller_id
  const priceUSD = Number(listing.price_cents) / 100

  return (
    <Card className="bg-cyber-dark/60 border border-cyber-cyan/30 hover:border-cyber-cyan/60 transition-all duration-300 overflow-hidden hover:shadow-[0_0_30px_rgba(34,211,238,0.3)]">
      <CardContent className="p-3">
        {/* Card frame with trading card aspect ratio - clickable */}
        <button 
          onClick={() => !isSeller && onView(listing)}
          disabled={isSoldOrInactive || isSeller}
          className="block relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-lg overflow-hidden cursor-pointer group w-full border-2 border-cyber-cyan/50 transition-all duration-300 hover:border-cyber-cyan disabled:cursor-default"
        >
          <Image
            src={listing.image_url || '/placeholder.svg'}
            alt={listing.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-fill"
            priority
          />
          
          {/* Hover overlay with view text */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Background gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-cyber-dark/95 via-cyber-dark/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            {/* View text in center on hover (only for buyers) */}
            {!isSeller && !isSoldOrInactive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-cyber-cyan text-lg font-bold tracking-wider opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-90 group-hover:scale-100">VIEW</span>
              </div>
            )}
          </div>
        </button>
        
        {/* Card info below */}
        <div className="mt-3 space-y-1">
          <h3 className="text-sm font-semibold text-white truncate" title={listing.title}>
            {listing.title}
          </h3>
          <div className="flex items-center justify-between">
            <div className="flex items-end gap-2">
              <span className="text-base font-bold text-cyber-green leading-none">${priceUSD.toFixed(0)}</span>
              {/* Status indicator - aligned to bottom of price */}
              <div className={`flex items-center gap-1 pb-[1px] ${isSoldOrInactive ? 'text-red-400' : 'text-emerald-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isSoldOrInactive ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
                <span className="text-[10px] uppercase tracking-wider opacity-80 leading-none">
                  {isSoldOrInactive ? 'Sold' : 'Available'}
                </span>
              </div>
            </div>
            {/* Seller avatar - increased size for better visibility */}
            <Link
              href={`/seller/${listing.seller_id}`}
              title={seller?.display_name || 'View seller'}
              className="relative grid place-items-center w-8 h-8 rounded-full overflow-hidden border border-cyber-cyan/50 hover:border-cyber-cyan transition-colors hover:scale-110"
            >
              {seller?.avatar_url ? (
                <Image
                  src={seller.avatar_url}
                  alt={seller.display_name || 'Seller'}
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              ) : (seller?.display_name && initials(seller.display_name) !== '?') ? (
                <span className="text-cyber-cyan text-xs font-bold">
                  {initials(seller.display_name)}
                </span>
              ) : (
                <UserIcon className="w-4 h-4 text-cyber-cyan" />
              )}
            </Link>
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="mt-3 space-y-2">
          {isSeller ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onCancel(listing)}
              disabled={isSoldOrInactive}
              className="w-full text-xs h-8"
            >
              {isSoldOrInactive ? 'Unavailable' : 'Cancel Listing'}
            </Button>
          ) : (
            <Button 
              className="cyber-button w-full text-xs h-8" 
              size="sm" 
              onClick={() => onBuy(listing)}
              disabled={isSoldOrInactive}
            >
              Buy Now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ───────────────────────── page ───────────────────────── */

export default function MarketplacePage() {
  const router = useRouter()
  const supabase: SupabaseClient = createClientComponentClient()
  const { toast } = useToast()

  const [uid, setUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<ListingRow[]>([])
  const [q, setQ] = useState('')
  const [sellerMap, setSellerMap] = useState<Record<string, SellerMeta>>({})
  
  // Detail modal state
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedListing, setSelectedListing] = useState<ListingRow | null>(null)

  // resolve session
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      setUid(session?.user?.id ?? null)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  const loadSellerMeta = useCallback(
    async (sellerIds: string[]) => {
      if (sellerIds.length === 0) return
      const uniq = Array.from(new Set(sellerIds))
      const { data, error } = await supabase
        .from('mkt_profiles')
        .select('id, display_name, avatar_url')
        .in('id', uniq)
        .returns<SellerMeta[]>()

      if (!error && data) {
        const map: Record<string, SellerMeta> = {}
        for (const s of data) map[s.id] = s
        setSellerMap(map)
      }
    },
    [supabase]
  )

  const loadListings = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('mkt_listings')
      .select('id,title,description,image_url,price_cents,currency,seller_id,buyer_id,status,is_active,created_at')
      .eq('status', 'listed')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (q.trim()) {
      const like = `%${q.trim()}%`
      query = query.or(`title.ilike.${like},description.ilike.${like}`)
    }

    const { data, error } = await query.returns<ListingRow[]>()

    if (error) {
      console.error('loadListings error:', error.message)
      setListings([])
      setLoading(false)
      return
    }

    const rows = data ?? []
    setListings(rows)
    setLoading(false)

    // fetch seller meta for avatar + name
    loadSellerMeta(rows.map(r => r.seller_id))
  }, [supabase, q, loadSellerMeta])

  useEffect(() => {
    loadListings()
  }, [loadListings])

  const resultsText = useMemo(() => {
    if (loading) return 'Loading…'
    const n = listings.length
    return `${n} item${n === 1 ? '' : 's'} found`
  }, [loading, listings.length])

  // seller-only action
  const cancelListing = useCallback(
    async (listing: ListingRow) => {
      if (!uid || uid !== listing.seller_id) {
        toast({
          title: 'Unable to cancel',
          description: 'Only the seller can cancel this listing.',
          variant: 'destructive',
        })
        return
      }

      const { error } = await supabase
        .from('mkt_listings')
        .update({ status: 'inactive', is_active: false })
        .eq('id', listing.id)
        .eq('seller_id', uid)

      if (error) {
        toast({ title: 'Cancel failed', description: error.message, variant: 'destructive' })
        return
      }

      setListings(prev => prev.filter(r => r.id !== listing.id))
      toast({ title: 'Listing canceled', description: `${listing.title} removed.` })
    },
    [supabase, uid, toast]
  )

  // buy action with auth gate
  const handleBuy = useCallback(
    (listing: ListingRow) => {
      if (listing.status !== 'listed' || !listing.is_active) {
        toast({ title: 'Unavailable', description: 'This item is not currently available.', variant: 'destructive' })
        return
      }

      const checkoutUrl = `/checkout?listingId=${listing.id}`

      if (!uid) {
        signInWithGoogle(checkoutUrl)
        return
      }

      router.push(checkoutUrl)
    },
    [uid, router, toast]
  )
  
  // open detail modal
  const openDetailModal = useCallback((listing: ListingRow) => {
    setSelectedListing(listing)
    setDetailModalOpen(true)
  }, [])
  
  // Navigation functions for modal
  const navigateToNext = useCallback(() => {
    if (!selectedListing || listings.length === 0) return
    const currentIndex = listings.findIndex(l => l.id === selectedListing.id)
    const nextIndex = (currentIndex + 1) % listings.length
    setSelectedListing(listings[nextIndex])
  }, [selectedListing, listings])
  
  const navigateToPrevious = useCallback(() => {
    if (!selectedListing || listings.length === 0) return
    const currentIndex = listings.findIndex(l => l.id === selectedListing.id)
    const prevIndex = currentIndex === 0 ? listings.length - 1 : currentIndex - 1
    setSelectedListing(listings[prevIndex])
  }, [selectedListing, listings])
  
  // Get current position for indicator
  const currentPosition = useMemo(() => {
    if (!selectedListing || listings.length === 0) return { current: 0, total: 0 }
    const index = listings.findIndex(l => l.id === selectedListing.id)
    return { current: index + 1, total: listings.length }
  }, [selectedListing, listings])

  return (
    <div className="min-h-screen bg-cyber-black relative overflow-hidden font-mono">
      {/* subtle grid + scanlines to match the rest of the site */}
      <div className="absolute inset-0 cyber-grid opacity-10 pointer-events-none" />
      <div className="absolute inset-0 scanlines opacity-20 pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 py-8 pt-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold tracking-wider text-white">Marketplace</h1>
          <p className="text-gray-400">Discover and purchase amazing cards</p>
        </div>

        {/* Search only (no price filters since price is fixed) */}
        <div className="flex flex-col md:flex-row items-stretch gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              placeholder="Search listings…"
              className="pl-10 h-12 bg-cyber-dark/60 border-cyber-cyan/30 focus:border-cyber-cyan/60 text-white"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadListings()}
            />
          </div>
          <Button
            onClick={loadListings}
            className="h-12 bg-cyber-dark border-2 border-cyber-cyan text-cyber-cyan hover:bg-cyber-cyan/10"
          >
            Refresh
          </Button>
        </div>

        {/* Results */}
        <div className="flex items-end justify-between mb-4">
          <p className="text-gray-400">{resultsText}</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-cyber-dark/60 border border-cyber-cyan/30 rounded-lg p-3 animate-pulse">
                {/* Card skeleton with trading card aspect ratio */}
                <div className="relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-lg border-2 border-cyber-cyan/20">
                  <div className="absolute inset-0 bg-cyber-cyan/5 animate-pulse" />
                </div>
                {/* Title skeleton */}
                <div className="mt-3 space-y-2">
                  <div className="h-4 bg-cyber-cyan/10 rounded animate-pulse" />
                  <div className="flex justify-between items-center">
                    <div className="h-4 w-16 bg-cyber-green/10 rounded animate-pulse" />
                    <div className="w-8 h-8 rounded-full bg-cyber-cyan/10 animate-pulse" />
                  </div>
                </div>
                {/* Button skeleton */}
                <div className="mt-3">
                  <div className="h-8 bg-cyber-cyan/10 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {listings.map((row) => (
              <MarketplaceCard
                key={row.id}
                listing={row}
                currentUserId={uid}
                seller={sellerMap[row.seller_id]}
                onCancel={cancelListing}
                onBuy={handleBuy}
                onView={openDetailModal}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Listing Detail Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl bg-cyber-dark/95 border-2 border-cyber-cyan/50 text-white h-[85vh] max-h-[85vh] md:h-auto md:max-h-[85vh] flex flex-col p-0 gap-0 relative">
          {/* Navigation buttons - both mobile and desktop */}
          {listings.length > 1 && (
            <>
              {/* Desktop buttons - outside modal when viewport > 1008px, further out on larger screens */}
              <button
                onClick={navigateToPrevious}
                className="hidden min-[1008px]:flex absolute -left-14 lg:-left-16 xl:-left-20 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-cyber-dark/90 backdrop-blur-sm border-2 border-cyber-cyan/50 hover:border-cyber-cyan hover:bg-gray-800/90 active:bg-gray-700/90 transition-all duration-300 items-center justify-center"
                aria-label="Previous card"
              >
                <ChevronLeft className="w-6 h-6 text-cyber-cyan" />
              </button>
              <button
                onClick={navigateToNext}
                className="hidden min-[1008px]:flex absolute -right-14 lg:-right-16 xl:-right-20 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-cyber-dark/90 backdrop-blur-sm border-2 border-cyber-cyan/50 hover:border-cyber-cyan hover:bg-gray-800/90 active:bg-gray-700/90 transition-all duration-300 items-center justify-center"
                aria-label="Next card"
              >
                <ChevronRight className="w-6 h-6 text-cyber-cyan" />
              </button>
              
              {/* Mobile/Tablet buttons - inside modal when viewport < 1008px */}
              <button
                onClick={navigateToPrevious}
                className="min-[1008px]:hidden absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-cyber-dark/90 backdrop-blur-sm border-2 border-cyber-cyan/50 hover:border-cyber-cyan hover:bg-gray-800/90 active:bg-gray-700/90 transition-all duration-300 flex items-center justify-center"
                aria-label="Previous card"
              >
                <ChevronLeft className="w-5 h-5 text-cyber-cyan" />
              </button>
              <button
                onClick={navigateToNext}
                className="min-[1008px]:hidden absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-cyber-dark/90 backdrop-blur-sm border-2 border-cyber-cyan/50 hover:border-cyber-cyan hover:bg-gray-800/90 active:bg-gray-700/90 transition-all duration-300 flex items-center justify-center"
                aria-label="Next card"
              >
                <ChevronRight className="w-5 h-5 text-cyber-cyan" />
              </button>
            </>
          )}
          {selectedListing && (
            <>
              {/* Mobile Layout - No Scroll */}
              <div className="md:hidden flex flex-col h-full p-3">
                {/* Card image container - maximized size */}
                <div className="flex-1 min-h-0 relative mb-3">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div 
                      className="relative bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-2xl border-2 border-cyber-cyan/50 overflow-hidden"
                      style={{
                        width: 'min(100%, calc((100vh * 0.6) * 5/7))',
                        aspectRatio: '5/7'
                      }}
                    >
                      <Image
                        src={selectedListing.image_url || '/placeholder.svg'}
                        alt={selectedListing.title}
                        fill
                        sizes="100vw"
                        className="object-fill"
                        priority
                      />
                    </div>
                  </div>
                </div>
                  
                {/* Compact info section */}
                <div className="space-y-2 mb-3">
                  {/* Title and Price on same line */}
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-bold text-white leading-tight flex-1">
                      {selectedListing.title}
                    </h2>
                    <div className="flex flex-col items-end">
                      <span className="text-xl font-bold text-cyber-green leading-none">
                        ${(selectedListing.price_cents / 100).toFixed(2)}
                      </span>
                      <div className={`flex items-center gap-1 mt-1 ${
                        selectedListing.status !== 'listed' || !selectedListing.is_active 
                          ? 'text-red-400' 
                          : 'text-emerald-400'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          selectedListing.status !== 'listed' || !selectedListing.is_active 
                            ? 'bg-red-400' 
                            : 'bg-emerald-400 animate-pulse'
                        }`} />
                        <span className="text-[10px] uppercase tracking-wider leading-none">
                          {selectedListing.status !== 'listed' || !selectedListing.is_active 
                            ? 'Sold' 
                            : 'Available'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Seller Info - Super Compact */}
                  <Link 
                    href={`/seller/${selectedListing.seller_id}`}
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    <div className="relative w-8 h-8 rounded-full overflow-hidden border border-cyber-cyan/50 flex-shrink-0">
                      {sellerMap[selectedListing.seller_id]?.avatar_url ? (
                        <Image
                          src={sellerMap[selectedListing.seller_id].avatar_url!}
                          alt={sellerMap[selectedListing.seller_id].display_name || 'Seller'}
                          fill
                          sizes="32px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-cyber-dark grid place-items-center">
                          {sellerMap[selectedListing.seller_id]?.display_name ? (
                            <span className="text-cyber-cyan text-xs font-bold">
                              {initials(sellerMap[selectedListing.seller_id].display_name)}
                            </span>
                          ) : (
                            <UserIcon className="w-4 h-4 text-cyber-cyan" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Seller:</span>
                      <span className="text-sm text-white">
                        {sellerMap[selectedListing.seller_id]?.display_name || 'Unknown'}
                      </span>
                    </div>
                  </Link>
                  
                  {/* Description - Only if short */}
                  {selectedListing.description && selectedListing.description.length < 100 && (
                    <p className="text-xs text-gray-300 line-clamp-2">
                      {selectedListing.description}
                    </p>
                  )}
                </div>
                
                {/* Action buttons - no border, integrated */}
                <div className="flex gap-2 flex-shrink-0">
                  {uid === selectedListing.seller_id ? (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setDetailModalOpen(false)
                        cancelListing(selectedListing)
                      }}
                      disabled={selectedListing.status !== 'listed' || !selectedListing.is_active}
                      className="flex-1 h-11"
                    >
                      Cancel Listing
                    </Button>
                  ) : (
                    <>
                      <Button 
                        variant="outline" 
                        onClick={() => setDetailModalOpen(false)}
                        className="flex-1 h-11 bg-transparent border border-cyber-pink text-cyber-pink hover:text-cyber-pink hover:border-cyber-pink/70 hover:bg-cyber-pink/10 transition-all"
                      >
                        Close
                      </Button>
                      <Button 
                        className="flex-1 h-11 cyber-button text-base font-bold" 
                        onClick={() => {
                          setDetailModalOpen(false)
                          handleBuy(selectedListing)
                        }}
                        disabled={selectedListing.status !== 'listed' || !selectedListing.is_active}
                      >
                        Buy Now
                      </Button>
                    </>
                  )}
                </div>
              </div>
              
              {/* Desktop Layout */}
              <div className="hidden md:grid md:grid-cols-2 gap-6 p-6">
                {/* Left side - Image */}
                <div className="relative aspect-[5/7] bg-gradient-to-br from-cyber-dark/40 to-cyber-dark/80 rounded-2xl overflow-hidden border-2 border-cyber-cyan/50">
                  <Image
                    src={selectedListing.image_url || '/placeholder.svg'}
                    alt={selectedListing.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-fill"
                    priority
                  />
                </div>
                
                {/* Right side - Details */}
                <div className="flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-bold text-white mb-4">
                      {selectedListing.title}
                    </DialogTitle>
                  </DialogHeader>
                  
                  <div className="flex-1 space-y-4">
                  {/* Description */}
                  {selectedListing.description && (
                    <div>
                      <h3 className="text-sm text-gray-400 mb-2">Description</h3>
                      <p className="text-white">{selectedListing.description}</p>
                    </div>
                  )}
                  
                  {/* Price and Status */}
                  <div>
                    <h3 className="text-sm text-gray-400 mb-2">Price</h3>
                    <div className="flex items-end gap-3">
                      <span className="text-3xl font-bold text-cyber-green leading-none">
                        ${(selectedListing.price_cents / 100).toFixed(2)}
                      </span>
                      <div className={`flex items-center gap-1 pb-[2px] ${
                        selectedListing.status !== 'listed' || !selectedListing.is_active 
                          ? 'text-red-400' 
                          : 'text-emerald-400'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          selectedListing.status !== 'listed' || !selectedListing.is_active 
                            ? 'bg-red-400' 
                            : 'bg-emerald-400 animate-pulse'
                        }`} />
                        <span className="text-sm uppercase tracking-wider leading-none">
                          {selectedListing.status !== 'listed' || !selectedListing.is_active 
                            ? 'Unavailable' 
                            : 'Available'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Seller Info */}
                  <div>
                    <h3 className="text-sm text-gray-400 mb-2">Seller</h3>
                    <Link 
                      href={`/seller/${selectedListing.seller_id}`}
                      className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-cyber-cyan">
                        {sellerMap[selectedListing.seller_id]?.avatar_url ? (
                          <Image
                            src={sellerMap[selectedListing.seller_id].avatar_url!}
                            alt={sellerMap[selectedListing.seller_id].display_name || 'Seller'}
                            fill
                            sizes="40px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-cyber-dark grid place-items-center">
                            {sellerMap[selectedListing.seller_id]?.display_name ? (
                              <span className="text-cyber-cyan text-sm font-bold">
                                {initials(sellerMap[selectedListing.seller_id].display_name)}
                              </span>
                            ) : (
                              <UserIcon className="w-5 h-5 text-cyber-cyan" />
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-white">
                        {sellerMap[selectedListing.seller_id]?.display_name || 'Unknown Seller'}
                      </span>
                    </Link>
                  </div>
                  
                  {/* Metadata */}
                  {selectedListing.created_at && (
                    <div>
                      <h3 className="text-sm text-gray-400 mb-2">Listed</h3>
                      <p className="text-white">
                        {new Date(selectedListing.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  </div>
                  
                  {/* Action Buttons */}
                  <DialogFooter className="mt-6 gap-3">
                    {uid === selectedListing.seller_id ? (
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setDetailModalOpen(false)
                          cancelListing(selectedListing)
                        }}
                        disabled={selectedListing.status !== 'listed' || !selectedListing.is_active}
                        className="flex-1"
                      >
                        Cancel Listing
                      </Button>
                    ) : (
                      <>
                        <Button 
                          variant="outline" 
                          onClick={() => setDetailModalOpen(false)}
                          className="flex-1 bg-transparent border border-cyber-pink text-cyber-pink hover:text-cyber-pink hover:border-cyber-pink/70 hover:bg-cyber-pink/10 transition-all"
                        >
                          Close
                        </Button>
                        <Button 
                          className="flex-1 cyber-button" 
                          onClick={() => {
                            setDetailModalOpen(false)
                            handleBuy(selectedListing)
                          }}
                          disabled={selectedListing.status !== 'listed' || !selectedListing.is_active}
                        >
                          Buy Now
                        </Button>
                      </>
                    )}
                  </DialogFooter>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
