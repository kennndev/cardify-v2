# 3D Texture Persistence Bug Investigation

## Problem Description
When clicking "Buy Physical" on different cards in the profile page, the first card's image persists on the 3D case preview's Card Front material, even when opening the modal for a different card.

## Attempted Fixes That Did NOT Work

### Attempt 1: Material Disposal and Cleanup
**What was tried:**
- Added `materialsRef` to track all created materials
- Implemented `disposeMaterials()` function to dispose textures and materials
- Added cleanup in useEffect return function
- Disposed materials before creating new ones

**Why it didn't work:**
- Materials were being disposed but the texture from `useLoader` was cached
- The mesh still held references to the old material
- Disposal alone doesn't force texture updates

### Attempt 2: Conditional Rendering for Proper Unmounting
**What was tried:**
- Changed from opacity-based hiding to conditional rendering: `{showCase3DPreview && (...)}`
- Ensured 3D component properly unmounts when not needed
- Modal returns `null` when not visible to fully unmount components

**Why it didn't work:**
- Even with proper unmounting, when the component remounts, `useLoader` returns cached textures
- The GLB model and its meshes are also cached by `useGLTF`

### Attempt 3: Always Create New Materials
**What was tried:**
- Removed conditional checks like `if (!materialsRef.current.cardFront)`
- Always create new materials when useEffect runs
- Force new material assignment to meshes

**Why it didn't work:**
- Even with new materials, the texture itself is cached by React Three Fiber's `useLoader`
- The `useLoader` hook caches textures by URL and returns the same texture instance
- Creating new materials with the same cached texture doesn't update the image

## Root Cause Analysis

### The Cache Problem
1. **`useLoader` caches textures by URL** - When the same URL is used, it returns the cached texture
2. **`useGLTF` caches the GLB model** - The model geometry and structure are reused
3. **Three.js texture cache** - Three.js itself has internal texture caching

### The Execution Order Issue
1. Component mounts with new `cardFrontImage` prop
2. `useLoader` is called with new URL but may return cached texture if URL was seen before
3. Materials are created/updated but texture might not be fresh
4. The 3D model displays the wrong image

## What Needs to Actually Happen

For the texture to properly update, we need to:

1. **Force texture cache invalidation** when component mounts with new image
2. **Ensure `useLoader` loads fresh texture** not cached version
3. **Update texture on existing material** rather than just creating new materials
4. **Or bypass `useLoader` entirely** and manually load textures

## Potential Solutions to Try

### Solution 1: Clear Three.js Cache
```javascript
import { Cache } from 'three'
// In component
useEffect(() => {
  Cache.clear()
  // Then load textures
}, [cardFrontImage])
```

### Solution 2: Manual Texture Loading
```javascript
// Instead of useLoader, manually load textures
useEffect(() => {
  const loader = new THREE.TextureLoader()
  loader.load(cardFrontImage, (texture) => {
    // Apply texture to material
  })
}, [cardFrontImage])
```

### Solution 3: Force Cache Busting
```javascript
// Add timestamp or random query param to URL
const bustCache = (url) => `${url}?t=${Date.now()}`
const [frontTexture] = useLoader(TextureLoader, [bustCache(cardFrontImage)])
```

### Solution 4: Update Existing Material's Map
```javascript
// Instead of creating new material, update existing one
if (material.map) {
  material.map.dispose()
}
material.map = newTexture
material.needsUpdate = true
```

### Attempt 4: Cache Busting with Query Parameters
**What was tried:**
- Added cache-busting query parameters to texture URLs: `${url}?v=${encodeURIComponent(url)}`
- This should force `useLoader` to treat each URL as unique
- Added texture disposal in cleanup functions
- Applied to both CardCase3DViewerOptimized and CustomCardCase3DViewer

**Why it didn't work:**
- The texture still persists across different cards
- Cache-busting may not be effective if the issue isn't actually about URL caching
- The problem might be at a different level than texture loading

## Current Status
The cache-busting approach also failed. The first card's image continues to persist in the 3D preview when switching between different cards. This suggests the problem might not be texture caching at all.

## Alternative Root Causes to Investigate

### Possibility 1: Component Memoization Issue
- Both components use `memo()` which might be preventing re-renders
- The memo comparison might not be detecting prop changes correctly
- The CardCaseModel component might be holding onto stale closures

### Possibility 2: Material Reference Issue
- The materials might be getting shared across instances
- The GLB model's meshes might be holding references to materials
- The material assignment might not be updating the mesh properly

### Possibility 3: Modal State Management
- The modal might be keeping the component mounted
- State might not be clearing between modal opens
- The component key might not be changing to force remount

### Possibility 4: Three.js Scene Graph Issue
- The primitive object might be reusing the same scene
- The GLB model scene might need cloning
- Materials might be shared at the Three.js level, not React level

### Attempt 5: Remove Memoization and Clone Scene ✅ SUCCESSFUL
**What was tried:**
- Removed `memo()` from all components to prevent stale closure issues
- Added `useMemo(() => gltf.scene.clone())` to clone the GLB scene
- Applied materials to the cloned scene instead of the original
- This ensures each component instance has its own scene graph

**Why it worked:**
- The root cause was that the GLB model's scene was being shared across all component instances
- Even though we were creating new materials, they were being applied to the same shared meshes
- Cloning the scene gives each component instance its own separate mesh objects
- Each cloned mesh can now have its own unique materials and textures
- Removing memoization ensured components re-render properly when props change

## Solution Summary
The issue was resolved by:
1. **Scene Cloning**: Using `gltf.scene.clone()` to create a unique scene graph for each component instance
2. **Removing Memoization**: Eliminating `memo()` wrappers that were preventing proper re-renders
3. **Proper Dependencies**: Ensuring useEffect hooks depend on the cloned scene, not the original

This fix ensures that each 3D card preview has its own independent scene, meshes, and materials, preventing texture persistence across different cards.

## Additional Fixes (Current Session)

### Issue 1: Image Flashing Before Correct Texture Loads
**Problem:**
When the 3D preview components load, there was a brief flash of incorrect textures (from Three.js cache) before the correct textures were applied.

**Solution:**
Added a `texturesReady` state to both `CardCase3DViewerOptimized.tsx` and `CustomCardCase3DViewer.tsx`:
- Set `texturesReady` to `false` when images change
- Hide the 3D model (`visible={texturesReady}`) until textures are properly loaded
- Add a 100ms delay after applying materials to ensure proper loading
- This prevents any visual flashing during texture transitions

### Issue 2: Wrong Card Displayed in Generate Page Modal
**Problem:**
When users generated multiple cards and navigated between them using arrows, the 3D preview in the checkout modal always showed the last generated card instead of the currently selected one.

**Root Cause:**
The `CustomCard3DPreviewWrapper` was prioritizing `uploadedImageUrl` (Supabase URL of last generated card) over `uploadedImage` (currently selected card).

**Solution:**
Changed the priority in `CustomCardCheckoutModal.tsx`:
```javascript
// Before:
cardFrontImage={uploadedImageUrl || uploadedImage || "/placeholder.jpg"}
// After:
cardFrontImage={uploadedImage || uploadedImageUrl || "/placeholder.jpg"}
```

### Issue 3: Upload Page Re-upload Issues
**Problem:**
On the upload page, when users uploaded a new image after already uploading one, the 3D preview would show the previous upload.

**Solution:**
In `app/upload/page.tsx`, clear the `uploadedImageUrl` when a new file is uploaded:
```javascript
const handleFileUpload = useCallback(async (file: File) => {
  // ... other code ...
  
  // Clear the previous upload URL to ensure the 3D preview updates
  setUploadedImageUrl(null)
  
  const previewURL = URL.createObjectURL(file)
  setUploadedImage(previewURL)
  // ...
})
```

### Issue 4: Modal Close Page Reload
**Problem:**
Both generate and upload pages were reloading when the checkout modal closed, losing user session state.

**Solution:**
Removed `window.location.reload()` from modal close handlers:
- `app/generate/page.tsx`: Changed to `onClose={() => setShowCheckoutModal(false)}`
- `app/upload/page.tsx`: Changed to `onClose={() => setShowCheckoutModal(false)}`

## Key Learnings
1. **Texture Caching**: Three.js aggressively caches textures, requiring careful state management
2. **Component Priority**: For display purposes, prioritize current/local state over persisted URLs
3. **Loading States**: Always implement loading states for 3D components to prevent visual artifacts
4. **State Cleanup**: Clear previous state when new uploads occur to prevent stale data issues