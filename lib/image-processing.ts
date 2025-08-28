/**
 * Image processing utilities for handling custom card uploads
 * Ensures uploaded images match the preview by applying the same stretching logic as CSS object-fill
 */

/**
 * Stretches an image to match the standard playing card aspect ratio (2.5:3.5)
 * Uses the same stretching logic as CSS object-fill to ensure preview matches output
 * @param file - The original image file
 * @param targetRatio - The target aspect ratio (width/height), defaults to 2.5/3.5
 * @returns Promise<Blob> - The stretched image as a blob
 */
export async function cropImageToAspectRatio(
  file: File,
  targetRatio: number = 2.5 / 3.5
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let imageUrl: string | null = null
    let useDataUrl = false
    
    // Function to load image with fallback to data URL
    const loadImage = async () => {
      try {
        // First try blob URL
        if (!useDataUrl) {
          imageUrl = URL.createObjectURL(file)
          img.src = imageUrl
        } else {
          // Fallback to data URL for better compatibility
          const reader = new FileReader()
          const dataUrl = await new Promise<string>((res, rej) => {
            reader.onload = () => res(reader.result as string)
            reader.onerror = rej
            reader.readAsDataURL(file)
          })
          img.src = dataUrl
        }
      } catch (err) {
        reject(new Error(`Failed to create image URL: ${err}`))
      }
    }

    img.onload = async () => {
      try {
        // Clean up blob URL if we used one
        if (imageUrl && !useDataUrl) {
          URL.revokeObjectURL(imageUrl)
        }

        // Detect if mobile device based on screen size and touch support
        const isMobile = typeof window !== 'undefined' && 
          (window.innerWidth < 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0)
        
        // Never upscale images - only downscale if needed
        // Max width: 1024px to keep file sizes reasonable
        const maxWidth = 1024
        const outputWidth = Math.min(img.width, maxWidth)
        const outputHeight = Math.round(outputWidth / targetRatio)
        
        console.log(`Processing image for ${isMobile ? 'mobile' : 'desktop'}: ${outputWidth}x${outputHeight}px`)

        const canvas = document.createElement('canvas')
        canvas.width = outputWidth
        canvas.height = outputHeight

        const ctx = canvas.getContext('2d', { 
          // Add options for better memory management
          willReadFrequently: false,
          desynchronized: true 
        })
        
        if (!ctx) {
          throw new Error('Failed to get canvas context')
        }

        // Enable high quality image smoothing
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'

        // Draw the entire image stretched to fill the canvas (object-fill behavior)
        // This matches the preview which uses object-fill
        ctx.drawImage(
          img,
          0, 0, img.width, img.height,              // Source rectangle (entire image)
          0, 0, outputWidth, outputHeight           // Destination rectangle (full canvas, stretched)
        )

        // Helper function to compress image with progressive quality reduction
        const compressImage = async (targetQuality: number, maxSizeMB: number = 2.8): Promise<Blob> => {
          return new Promise((resolveCompress, rejectCompress) => {
            // Force JPEG conversion using toDataURL then convert to blob
            const dataUrl = canvas.toDataURL('image/jpeg', targetQuality)
            
            // Convert data URL to blob
            fetch(dataUrl)
              .then(res => res.blob())
              .then(async (blob) => {
                const sizeMB = blob.size / (1024 * 1024)
                console.log(`Compressed to ${sizeMB.toFixed(2)}MB at quality ${(targetQuality * 100).toFixed(0)}%`)
                
                // If still too large and quality can be reduced further
                if (sizeMB > maxSizeMB && targetQuality > 0.5) {
                  console.log(`Image still too large, reducing quality...`)
                  const nextQuality = Math.max(0.5, targetQuality - 0.1)
                  try {
                    const smallerBlob = await compressImage(nextQuality, maxSizeMB)
                    resolveCompress(smallerBlob)
                  } catch (err) {
                    rejectCompress(err)
                  }
                } else if (sizeMB > maxSizeMB) {
                  // If we've hit minimum quality but still too large, reduce dimensions
                  console.log(`At minimum quality but still ${sizeMB.toFixed(2)}MB, reducing dimensions...`)
                  const scaleFactor = 0.75
                  const smallerCanvas = document.createElement('canvas')
                  smallerCanvas.width = Math.round(canvas.width * scaleFactor)
                  smallerCanvas.height = Math.round(canvas.height * scaleFactor)
                  const smallerCtx = smallerCanvas.getContext('2d')
                  if (!smallerCtx) {
                    rejectCompress(new Error('Failed to create smaller canvas'))
                    return
                  }
                  smallerCtx.imageSmoothingEnabled = true
                  smallerCtx.imageSmoothingQuality = 'high'
                  smallerCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height)
                  
                  // Force JPEG with toDataURL for smaller canvas too
                  const smallerDataUrl = smallerCanvas.toDataURL('image/jpeg', 0.7)
                  fetch(smallerDataUrl)
                    .then(res => res.blob())
                    .then(smallerBlob => {
                      console.log(`Reduced dimensions to ${smallerCanvas.width}x${smallerCanvas.height}, size: ${(smallerBlob.size / (1024 * 1024)).toFixed(2)}MB`)
                      resolveCompress(smallerBlob)
                    })
                    .catch(err => rejectCompress(err))
                } else {
                  resolveCompress(blob)
                }
              })
              .catch(err => rejectCompress(err))
          })
        }
        
        // Start with reasonable quality and let it auto-adjust if needed
        const initialQuality = isMobile ? 0.8 : 0.85
        
        try {
          const compressedBlob = await compressImage(initialQuality)
          console.log(`Final image size: ${(compressedBlob.size / (1024 * 1024)).toFixed(2)}MB`)
          resolve(compressedBlob)
        } catch (error) {
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    }

    img.onerror = () => {
      // Clean up blob URL if it exists
      if (imageUrl && !useDataUrl) {
        URL.revokeObjectURL(imageUrl)
      }
      
      // If blob URL failed and we haven't tried data URL yet, try it
      if (!useDataUrl) {
        console.warn('Blob URL failed, trying data URL fallback...')
        useDataUrl = true
        loadImage().catch(err => reject(new Error('Failed to load image with both blob and data URL')))
      } else {
        reject(new Error('Failed to load image'))
      }
    }

    // Start loading the image
    loadImage().catch(reject)
  })
}

/**
 * Creates a File object from a Blob with the original filename
 * @param blob - The blob to convert
 * @param originalFilename - The original filename to preserve
 * @returns File object
 */
export function blobToFile(blob: Blob, originalFilename: string): File {
  // Preserve the original filename but indicate it's been processed
  const extension = originalFilename.split('.').pop() || 'png'
  const nameWithoutExt = originalFilename.substring(0, originalFilename.lastIndexOf('.')) || originalFilename
  const processedFilename = `${nameWithoutExt}_cropped.${extension}`
  
  return new File([blob], processedFilename, {
    type: blob.type,
    lastModified: Date.now()
  })
}

/**
 * Validates if an image file can be processed
 * @param file - The file to validate
 * @returns boolean indicating if the file is valid
 */
export function isValidImageFile(file: File): boolean {
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  const maxSize = 10 * 1024 * 1024 // 10MB
  
  return validTypes.includes(file.type) && file.size <= maxSize
}