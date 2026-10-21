import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureProfileRecord, updateProfileAvatar, UsageStoreMissing } from '@/lib/usage/store'
import { NextResponse } from 'next/server'
import sharp from 'sharp'

/**
 * The signed-in user's own avatar. Thin validating proxy (CLAUDE.md §5): read
 * the session, validate and normalise the image, write one Storage object, then
 * record its public URL through one store helper. No business logic beyond the
 * image-safety floor.
 *
 * Safety floor: the bytes are validated by *decoding* them with sharp, never by
 * trusting the client's MIME string; the image is re-encoded (which strips EXIF
 * and any trailing payload), constrained to an exact square, and the object path
 * is scoped to the caller's own id. Writes use the service-role client, so the
 * `avatars` bucket can stay read-public / write-locked on the anon key.
 */

export const runtime = 'nodejs'

const BUCKET = 'avatars'
const AVATAR_SIZE = 512
const MAX_BYTES = 2 * 1024 * 1024
const MIN_DIMENSION = 64
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp'])

function objectPath(userId: string) {
  return `${userId}/avatar.webp`
}

function storageUnavailable() {
  return NextResponse.json(
    { error: 'Image storage is not configured. Try again later.' },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let file: File | null = null
  try {
    const form = await request.formData()
    const value = form.get('avatar')
    if (value instanceof File) file = value
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No image was provided.' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large (max 2 MB).' }, { status: 413 })
  }

  const input = Buffer.from(await file.arrayBuffer())

  // Decode first: a non-image (or a spoofed type) fails here, before any write.
  let pipeline: sharp.Sharp
  let meta: sharp.Metadata
  try {
    pipeline = sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
    meta = await pipeline.metadata()
  } catch {
    return NextResponse.json({ error: 'That file is not a readable image.' }, { status: 415 })
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    return NextResponse.json({ error: 'Use a PNG, JPEG, or WebP image.' }, { status: 415 })
  }
  if ((meta.width ?? 0) < MIN_DIMENSION || (meta.height ?? 0) < MIN_DIMENSION) {
    return NextResponse.json({ error: `Image must be at least ${MIN_DIMENSION}×${MIN_DIMENSION}.` }, { status: 400 })
  }

  let normalised: Buffer
  try {
    normalised = await sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
      .rotate() // honour EXIF orientation, then drop it in the re-encode
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: 'That image could not be processed.' }, { status: 415 })
  }

  const service = createServiceClient()
  if (!service) return storageUnavailable()

  const path = objectPath(data.user.id)
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, normalised, { upsert: true, contentType: 'image/webp', cacheControl: '31536000' })
  if (uploadError) {
    console.error('Avatar upload failed', uploadError.message)
    return storageUnavailable()
  }

  // A version query busts the CDN cache after an overwrite at the same path.
  const { data: publicUrl } = service.storage.from(BUCKET).getPublicUrl(path)
  const versionedUrl = `${publicUrl.publicUrl}?v=${Date.now()}`

  try {
    await ensureProfileRecord(data.user.id, data.user.email ?? null)
    const profile = await updateProfileAvatar(data.user.id, versionedUrl)
    return NextResponse.json({ profile })
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      return NextResponse.json({ error: 'The profile store is unavailable. Try again in a moment.' }, { status: 503 })
    }
    console.error('Avatar profile update failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not save your photo.' }, { status: 500 })
  }
}

export async function DELETE() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const service = createServiceClient()
  if (service) {
    // Best-effort: the object may already be gone, or storage may be unset.
    const { error: removeError } = await service.storage.from(BUCKET).remove([objectPath(data.user.id)])
    if (removeError) console.error('Avatar remove failed', removeError.message)
  }

  try {
    await ensureProfileRecord(data.user.id, data.user.email ?? null)
    const profile = await updateProfileAvatar(data.user.id, null)
    return NextResponse.json({ profile })
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      return NextResponse.json({ error: 'The profile store is unavailable. Try again in a moment.' }, { status: 503 })
    }
    console.error('Avatar clear failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not remove your photo.' }, { status: 500 })
  }
}
