import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

// Type for API errors
interface ApiError {
  code?: string
  message?: string
  error?: {
    code?: string
    message?: string
    type?: string
  }
  status?: number
  type?: string
}

// Initialize OpenAI client with extended timeout
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 300000, // 5 minutes (300 seconds) - though OpenAI may timeout at ~180s
  maxRetries: 0, // Disable automatic retries to avoid duplicate requests
})

// Rate limiting configuration
const RATE_LIMIT = {
  MAX_FREE_GENERATIONS: 3,
  WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours
}

// Simple in-memory rate limiting (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function getClientIdentifier(req: NextRequest): string {
  // Use IP address as identifier (in production, use more sophisticated fingerprinting)
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown'
  return ip
}

function checkRateLimit(clientId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const clientData = rateLimitMap.get(clientId)
  
  if (!clientData || now > clientData.resetTime) {
    // New client or reset window expired
    rateLimitMap.set(clientId, {
      count: 1,
      resetTime: now + RATE_LIMIT.WINDOW_MS,
    })
    return { allowed: true, remaining: RATE_LIMIT.MAX_FREE_GENERATIONS - 1 }
  }
  
  if (clientData.count >= RATE_LIMIT.MAX_FREE_GENERATIONS) {
    return { allowed: false, remaining: 0 }
  }
  
  // Increment count
  clientData.count++
  rateLimitMap.set(clientId, clientData)
  return { allowed: true, remaining: RATE_LIMIT.MAX_FREE_GENERATIONS - clientData.count }
}

export async function POST(req: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not configured')
      return NextResponse.json(
        { 
          error: 'Image generation service not configured',
          code: 'SERVICE_UNAVAILABLE'
        },
        { status: 503 }
      )
    }
    
    // Check authentication
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    const { data: { user } } = await supabase.auth.getUser()
    
    // Parse request body
    const body = await req.json()
    const { prompt, referenceImage, referenceImagePath, referenceImageUrl, maintainLikeness = true, devReset } = body
    
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { 
          error: 'Invalid prompt provided',
          code: 'INVALID_PROMPT'
        },
        { status: 400 }
      )
    }
    
    // Rate limiting only for non-authenticated users
    let remaining = -1; // -1 means unlimited for authenticated users
    
    if (!user) {
      // Reset rate limit if devReset flag is passed (works in both dev and production)
      const clientId = getClientIdentifier(req)
      if (devReset) {
        rateLimitMap.delete(clientId)
        console.log(`🔧 Rate limit reset for client ${clientId}`)
      }
      
      // Check rate limiting for non-authenticated users only
      const rateLimitCheck = checkRateLimit(clientId)
      remaining = rateLimitCheck.remaining
      
      if (!rateLimitCheck.allowed) {
        return NextResponse.json(
          { 
            error: 'Rate limit exceeded. You have used all your free generations. Please sign in to continue.',
            code: 'RATE_LIMIT_EXCEEDED',
            remaining: 0
          },
          { status: 429 }
        )
      }
      
      console.log(`Generating image for non-authenticated client ${clientId}. Remaining: ${remaining}`)
    } else {
      console.log(`Generating image for authenticated user ${user.id}. No rate limits applied.`)
    }
    
    // Helper function to attempt image generation
    async function attemptGeneration(quality: "high" | "medium" = "high", isRetry: boolean = false) {
      if (isRetry) {
        console.log(`Retrying with ${quality} quality after timeout...`)
      }
      
      // Handle both old base64 format (backward compatibility) and new URL format
      const hasReferenceImage = referenceImage || referenceImageUrl
      
      if (hasReferenceImage) {
        // If reference image is provided, use the edit endpoint
        console.log(`Using image edit mode with reference image (quality: ${quality})`)
        
        // Prepare the prompt based on likeness preference
        let editPrompt: string
        if (maintainLikeness) {
          editPrompt = `Use this image as a reference, preserving the exact facial features and likeness of the person while adapting to this style: ${prompt}`
        } else {
          editPrompt = `Use this image as inspiration for the following prompt: ${prompt}`
        }
        
        // Convert image to File object for OpenAI API
        let imageFile: File;
        
        if (referenceImageUrl && !referenceImage) {
          // New flow: Fetch image from Supabase URL
          console.log('Fetching reference image from URL:', referenceImageUrl)
          
          try {
            const imageResponse = await fetch(referenceImageUrl)
            if (!imageResponse.ok) {
              throw new Error(`Failed to fetch image: ${imageResponse.statusText}`)
            }
            
            const imageBlob = await imageResponse.blob()
            imageFile = new File([imageBlob], 'reference.jpg', { type: imageBlob.type || 'image/jpeg' })
            
            console.log('Successfully fetched reference image, size:', imageFile.size)
          } catch (fetchError) {
            console.error('Failed to fetch reference image from URL:', fetchError)
            throw new Error('Failed to retrieve reference image from storage')
          }
        } else if (referenceImage) {
          // Old flow: Handle base64 image (backward compatibility)
          console.log('Using base64 reference image (legacy mode)')
          
          if (referenceImage.startsWith('data:')) {
            // Extract base64 data and mime type
            const matches = referenceImage.match(/^data:([^;]+);base64,(.+)$/)
            if (!matches) {
              throw new Error('Invalid image data format')
            }
            
            const mimeType = matches[1]
            const base64Data = matches[2]
            const buffer = Buffer.from(base64Data, 'base64')
            
            // Create a File object from the buffer
            const blob = new Blob([buffer], { type: mimeType })
            imageFile = new File([blob], 'reference.jpg', { type: 'image/jpeg' })
          } else {
            throw new Error('Invalid image format')
          }
        } else {
          throw new Error('No reference image provided')
        }
        
        // Use the edit endpoint for image-to-image generation
        return await openai.images.edit({
          model: "gpt-image-1",
          image: imageFile,
          prompt: editPrompt,
          size: "1024x1536", // Portrait format for trading cards
          quality: quality,
          // @ts-expect-error - input_fidelity is a new parameter not yet in TypeScript types
          input_fidelity: maintainLikeness && quality === "high" ? "high" : "medium", // Adjust fidelity with quality
        })
      } else {
        // Normal text-to-image generation
        return await openai.images.generate({
          model: "gpt-image-1",
          prompt: prompt,
          size: "1024x1536", // Portrait format - closest to trading card ratio (2.5:3.5)
          quality: quality,
        })
      }
    }
    
    try {
      // First attempt with high quality
      const response = await attemptGeneration("high", false)
      
      if (!response.data || response.data.length === 0) {
        throw new Error('No image generated')
      }
      
      // Log the full response to understand its structure
      console.log('Full response data:', JSON.stringify(response.data[0], null, 2))
      
      // Check for different possible response formats
      const imageUrl = response.data[0].url || response.data[0].b64_json
      
      if (!imageUrl) {
        console.error('Response structure:', response.data[0])
        throw new Error('No image URL or base64 data returned')
      }
      
      // If it's base64, convert to data URL
      const finalImageUrl = imageUrl.startsWith('data:') || imageUrl.startsWith('http') 
        ? imageUrl 
        : `data:image/png;base64,${imageUrl}`
      
      // Clean up temp reference image if path was provided
      if (referenceImagePath) {
        // Delete from Supabase storage directly
        try {
          const { error } = await supabase.storage
            .from('temp-references')
            .remove([referenceImagePath])
          
          if (error) {
            console.warn('Failed to cleanup temp reference image:', error)
          } else {
            console.log('Cleaned up temp reference image:', referenceImagePath)
          }
        } catch (cleanupError) {
          console.warn('Cleanup error:', cleanupError)
        }
      }
      
      return NextResponse.json({
        success: true,
        imageUrl: finalImageUrl,
        remaining: remaining,
        // GPT Image 1 provides a revised prompt for better results
        revisedPrompt: response.data[0].revised_prompt || prompt,
      })
      
    } catch (openAIError: unknown) {
      // Cast error to ApiError to access properties
      const error = openAIError as ApiError
      
      // Check if this is a timeout error (happens at ~180 seconds)
      const isTimeout = error?.code === 'ETIMEDOUT' || 
                       error?.code === 'ECONNABORTED' ||
                       error?.code === 'ECONNRESET' ||
                       error?.message?.toLowerCase().includes('timeout') ||
                       error?.message?.toLowerCase().includes('timed out') ||
                       error?.message?.toLowerCase().includes('aborted')
      
      // Retry once with medium quality on timeout
      if (isTimeout) {
        console.log('First attempt timed out after ~180 seconds, retrying with medium quality...')
        
        try {
          const response = await attemptGeneration("medium", true)
          
          if (!response.data || response.data.length === 0) {
            throw new Error('No image generated on retry')
          }
          
          const imageUrl = response.data[0].url || response.data[0].b64_json
          
          if (!imageUrl) {
            throw new Error('No image URL or base64 data returned on retry')
          }
          
          const finalImageUrl = imageUrl.startsWith('data:') || imageUrl.startsWith('http') 
            ? imageUrl 
            : `data:image/png;base64,${imageUrl}`
          
          // Clean up temp reference image if path was provided (on retry success)
          if (referenceImagePath) {
            try {
              const { error } = await supabase.storage
                .from('temp-references')
                .remove([referenceImagePath])
              
              if (error) {
                console.warn('Failed to cleanup temp reference image:', error)
              } else {
                console.log('Cleaned up temp reference image:', referenceImagePath)
              }
            } catch (cleanupError) {
              console.warn('Cleanup error:', cleanupError)
            }
          }
          
          return NextResponse.json({
            success: true,
            imageUrl: finalImageUrl,
            remaining: remaining,
            revisedPrompt: response.data[0].revised_prompt || prompt,
            qualityNote: 'Generated with medium quality due to timeout on high quality attempt'
          })
          
        } catch (retryError: unknown) {
          console.error('Retry with medium quality also failed:', retryError)
          const retryErr = retryError as ApiError
          // If retry also times out, return user-friendly error
          if (retryErr?.code === 'ETIMEDOUT' || 
              retryErr?.code === 'ECONNABORTED' ||
              retryErr?.code === 'ECONNRESET' ||
              retryErr?.message?.toLowerCase().includes('timeout') ||
              retryErr?.message?.toLowerCase().includes('timed out')) {
            return NextResponse.json(
              { 
                error: 'Image generation is taking too long. This may be due to server load or connection speed. Please try again later or use a simpler prompt.',
                code: 'TIMEOUT_ERROR',
                details: 'Both high and medium quality attempts timed out after 180 seconds each.'
              },
              { status: 504 }
            )
          }
          // Fall through to original error handling for non-timeout errors
        }
      }
      // Enhanced error logging to debug the issue
      console.error('OpenAI API error - Full details:')
      console.error('Error object:', JSON.stringify(error, null, 2))
      console.error('Error code:', error?.error?.code || error?.code)
      console.error('Error message:', error?.error?.message || error?.message)
      console.error('Error type:', error?.error?.type || error?.type)
      console.error('Status code:', error?.status)
      
      // Check for Cloudflare 1020 error (VPN/proxy detection)
      const isCloudflareBlock = error?.status === 403 && 
                               (error?.error?.code === '1020' || 
                                error?.code === '1020' ||
                                error?.message?.toLowerCase().includes('access denied') ||
                                error?.message?.toLowerCase().includes('cloudflare') ||
                                error?.error?.message?.toLowerCase().includes('access denied') ||
                                error?.error?.message?.toLowerCase().includes('cloudflare'))
      
      if (isCloudflareBlock) {
        return NextResponse.json(
          { 
            error: 'VPN detected. Image generation may be blocked when using VPN services like Surfshark. Please try: 1) Switching to a different VPN server location, 2) Using a different VPN protocol (WireGuard/OpenVPN), 3) Temporarily disabling your VPN, or 4) Using a dedicated IP if available.',
            code: 'VPN_DETECTED',
            details: 'Cloudflare is blocking access from this VPN IP address. This is a known issue with many VPN services.'
          },
          { status: 403 }
        )
      }
      
      // Handle specific OpenAI errors
      if (error?.error?.code === 'invalid_request_error' && 
          error?.error?.message?.includes('model')) {
        return NextResponse.json(
          { 
            error: 'GPT Image 1 requires API Organization Verification. Please complete verification in your OpenAI developer console.',
            code: 'VERIFICATION_REQUIRED',
            details: 'Visit https://platform.openai.com/settings/organization/general to complete verification'
          },
          { status: 403 }
        )
      }
      
      if (error?.error?.code === 'content_policy_violation' || 
          error?.error?.code === 'moderation_blocked') {
        const isReferenceImage = !!(referenceImage || referenceImageUrl)
        const errorMessage = isReferenceImage 
          ? 'Your reference image was blocked by content moderation. Please use a different image that complies with content guidelines.'
          : 'Your prompt was flagged by content policy. Please try a different prompt.'
        
        return NextResponse.json(
          { 
            error: errorMessage,
            code: 'CONTENT_POLICY_VIOLATION',
            details: isReferenceImage 
              ? 'Avoid: nudity, violence, hateful imagery, or copyrighted characters'
              : 'Avoid: explicit content, violence, or hateful language'
          },
          { status: 400 }
        )
      }
      
      if (error?.error?.code === 'billing_hard_limit_reached' || 
          error?.code === 'billing_hard_limit_reached') {
        return NextResponse.json(
          { 
            error: 'Image generation service is temporarily unavailable. Please use the demo mode.',
            code: 'SERVICE_UNAVAILABLE',
            details: 'Billing limit reached'
          },
          { status: 503 }
        )
      }
      
      if (error?.error?.code === 'rate_limit_exceeded') {
        return NextResponse.json(
          { 
            error: 'API rate limit reached. Please try again later.',
            code: 'API_RATE_LIMIT'
          },
          { status: 429 }
        )
      }
      
      // Check for network/connection errors that might indicate VPN interference
      const isNetworkError = error?.code === 'ECONNREFUSED' ||
                            error?.code === 'ENOTFOUND' ||
                            error?.code === 'EHOSTUNREACH' ||
                            error?.code === 'ENETUNREACH' ||
                            error?.message?.toLowerCase().includes('network') ||
                            error?.message?.toLowerCase().includes('connection refused')
      
      if (isNetworkError) {
        return NextResponse.json(
          { 
            error: 'Connection failed. If you are using a VPN (like Surfshark), it may be interfering with the connection. Try switching VPN servers or temporarily disabling it.',
            code: 'CONNECTION_ERROR',
            details: 'Network connection to OpenAI API failed'
          },
          { status: 503 }
        )
      }
      
      // Generic OpenAI error
      return NextResponse.json(
        { 
          error: 'Failed to generate image. Please try again.',
          code: 'GENERATION_FAILED',
          details: error?.error?.message || 'Unknown error'
        },
        { status: 500 }
      )
    }
    
  } catch (error) {
    console.error('Image generation error:', error)
    return NextResponse.json(
      { 
        error: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR'
      },
      { status: 500 }
    )
  }
}

// Handle unsupported methods
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}