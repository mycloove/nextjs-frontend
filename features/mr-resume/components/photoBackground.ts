// Photo background treatment (Mr. Resume studio, module-local).
//
// A portrait pasted onto a resume often carries its own backdrop — a wall, a
// studio curtain, a busy room — that clashes with the document's paper. This
// module replaces that backdrop entirely in the browser: it grows a mask
// outwards from the photo borders over near-uniform pixels (typical of portrait
// plates), extends it past the JPEG fringe, feathers the edge, and composites a
// document-palette color through the mask. The result is a flattened JPEG at
// the source size, so the treatment is baked into the photo itself — the
// preview, the draft PDF print and the photo file all agree, with no per-frame
// compositing and no second storage layer beside the draft.
//
// There is no AI service behind this: the mask is derived from the pixels
// alone. Photos with busy backdrops keep their original pixels wherever the
// mask is not confident, and both presets reject outright when the mask
// clearly failed, so the studio can say so instead of printing a flawed plate.
// Two of the presets are not plates: `blur` softens only the separated
// backdrop (the portrait keeps its own sharpness), and `custom` composites the
// studio's picked tint through the same mask path.

export type PhotoBackgroundId = 'none' | 'paper' | 'ivory' | 'accent' | 'ink' | 'blur' | 'custom'

export type PhotoBackground = {
  id: PhotoBackgroundId
  name: string
  /** Plate color for fixed presets. The `accent` preset has none — the studio
      resolves it to the document accent, so it follows Page settings. */
  color?: string
}

// Presets are drawn from the document's own palette (paper tones + the accent
// set), never from arbitrary stock colors, so any choice sits on the sheet.
// `blur` keeps the portrait sharp while softening only the separated backdrop;
// `custom` carries no color of its own — the studio keeps the picked tint in
// the draft (photoCustomColor) and reads it back on restore.
export const photoBackgrounds: PhotoBackground[] = [
  { id: 'none', name: 'Original' },
  { id: 'paper', name: 'Paper', color: '#ffffff' },
  { id: 'ivory', name: 'Ivory', color: '#f2efe6' },
  { id: 'accent', name: 'Accent' },
  { id: 'ink', name: 'Ink', color: '#2a2c26' },
  { id: 'blur', name: 'Blur' },
  { id: 'custom', name: 'Custom' },
]

export function photoBackgroundPlate(id: PhotoBackgroundId, accentColor: string): string {
  return photoBackgrounds.find((item) => item.id === id)?.color ?? accentColor
}

// The draft's custom tint and the native color input both promise #rrggbb;
// validating before baking keeps a malformed byte from NaN-ing the pixels.
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

type Rgb = [number, number, number]

function colorNear(data: Uint8ClampedArray, i: number, color: Rgb, tolerance: number): boolean {
  const red = data[i] - color[0]
  const green = data[i + 1] - color[1]
  const blue = data[i + 2] - color[2]
  return red * red + green * green + blue * blue <= tolerance * tolerance
}

// Region-growing from the border inwards. Two acceptance rules keep it usable
// on real snapshots: a pixel joins the mask when it sits near the border
// strip's average (bridges JPEG noise inside flat backdrops) or — for gradient
// backdrops — near its already-masked neighbour AND still recognisably close to
// that border tone. The drift cap matters: JPEG compression blurs every hard
// edge into a short sweep, and a neighbour-only rule would walk that sweep
// straight into the person (skin, hair, clothing) and eat the subject. With the
// drift cap the mask stops at edges a compression sweep cannot bridge.
function borderMask(frame: ImageData): Uint8Array {
  const { width, height, data } = frame
  const mask = new Uint8Array(width * height)
  const sum: Rgb = [0, 0, 0]
  let samples = 0
  const addSample = (byte: number) => {
    sum[0] += data[byte]
    sum[1] += data[byte + 1]
    sum[2] += data[byte + 2]
    samples += 1
  }
  for (let x = 0; x < width; x += 1) {
    addSample(x * 4)
    addSample(((height - 1) * width + x) * 4)
  }
  for (let y = 1; y < height - 1; y += 1) {
    addSample(y * width * 4)
    addSample((y * width + width - 1) * 4)
  }
  const border: Rgb = [sum[0] / samples, sum[1] / samples, sum[2] / samples]

  const NEIGHBOR = 26 // neighbour-to-neighbour tolerance
  const STRIP = 62 // pixel-to-border-average tolerance
  const DRIFT = 105 // how far a neighbour-chain may leave the border tone
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const seed = (pixel: number) => {
    if (mask[pixel]) return
    if (!colorNear(data, pixel * 4, border, STRIP)) return
    mask[pixel] = 1
    queue[tail] = pixel
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (head < tail) {
    const pixel = queue[head]
    head += 1
    const x = pixel % width
    const row = pixel - x
    const origin = pixel * 4
    const originColor: Rgb = [data[origin], data[origin + 1], data[origin + 2]]
    const visit = (neighbor: number) => {
      if (mask[neighbor]) return
      const byte = neighbor * 4
      if (!colorNear(data, byte, border, STRIP) && !(colorNear(data, byte, originColor, NEIGHBOR) && colorNear(data, byte, border, DRIFT))) return
      mask[neighbor] = 1
      queue[tail] = neighbor
      tail += 1
    }
    if (x > 0) visit(pixel - 1)
    if (x < width - 1) visit(pixel + 1)
    if (row !== 0) visit(pixel - width)
    if (row !== (height - 1) * width) visit(pixel + width)
  }
  return mask
}

// Widen the background mask past the crop line before feathering: JPEG halos
// leave the old backdrop's color smeared onto the subject's edge, and eating
// those two pixels is what keeps a Forest plate from printing with a beige rim.
function dilate(mask: Uint8Array, width: number, height: number, radius: number): void {
  const horizontal = Uint8Array.from(mask)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let offset = -radius; offset <= radius && value === 0; offset += 1) {
        const nx = x + offset
        if (nx >= 0 && nx < width) value = horizontal[row + nx]
      }
      mask[row + x] = value
    }
  }
  const vertical = Uint8Array.from(mask)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let offset = -radius; offset <= radius && value === 0; offset += 1) {
        const ny = y + offset
        if (ny >= 0 && ny < height) value = vertical[ny * width + x]
      }
      mask[y * width + x] = value
    }
  }
}

// Two 3x3 box passes turn the binary mask into a soft blade, so the plate
// blends out over a few pixels instead of gating at a hard stair-step.
function feather(weights: Float32Array, width: number, height: number): void {
  for (let pass = 0; pass < 2; pass += 1) {
    const source = Float32Array.from(weights)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let total = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx
            if (nx < 0 || nx >= width) continue
            total += source[ny * width + nx]
            count += 1
          }
        }
        weights[y * width + x] = total / count
      }
    }
  }
}

// Per-axis clamp-window box blur with a running sum — O(pixels) regardless of
// radius. Called three times per axis (Haeberli's stacked boxes), which lands
// close to a gaussian without relying on canvas `ctx.filter`, which several
// engines still do not implement. Runs on contiguous per-channel planes as
// `boxBlur` packs them: one byte per pixel, `width` bytes per row.
function blurAxis(channel: Float32Array, target: Float32Array, width: number, height: number, radius: number, horizontal: boolean): void {
  const win = radius * 2 + 1
  const lines = horizontal ? height : width
  const steps = horizontal ? width : height
  const stride = horizontal ? 1 : width
  const lineBase = horizontal ? width : 1
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineBase
    let sum = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += channel[base + Math.max(0, Math.min(steps - 1, offset)) * stride]
    }
    for (let step = 0; step < steps; step += 1) {
      target[base + step * stride] = sum / win
      const leaving = Math.max(0, step - radius)
      const entering = Math.min(steps - 1, step + radius + 1)
      sum += channel[base + entering * stride] - channel[base + leaving * stride]
    }
  }
}

// The Blur preset: same separation as the plate pipeline, but instead of a flat
// color the backdrop pixels are replaced with their own neighborhood's blur —
// depth-of-field style. The `percent` (the studio's 20–100% slider) maps onto a
// blur radius of 1–24 image pixels at the ingest cap (480px), so the same
// percentage means the same softness on every photo. The subject pixels sit
// under the feathered mask and keep their original sharpness.
export function blurPhotoBackground(source: string, percent: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const ratio = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('canvas unavailable')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const frame = context.getImageData(0, 0, canvas.width, canvas.height)
        const weights = backdropWeights(frame)
        if (!weights) throw new Error('backdrop not separable')
        const clamped = Math.max(0, Math.min(100, percent))
        const radius = Math.max(1, Math.round((clamped / 100) * 24))
        const blurred = boxBlur(frame.data, canvas.width, canvas.height, radius)
        compositeBlur(frame, weights, blurred)
        context.putImageData(frame, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('blur failed'))
      }
    }
    image.onerror = () => reject(new Error('unreadable image'))
    image.src = source
  })
}

function boxBlur(source: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const pixels = width * height
  // De-interleave once into contiguous per-channel planes — the layout
  // blurAxis's stride math assumes. Feeding it the interleaved RGBA copy would
  // sweep channel slots (and, worse, run past the alpha hole) instead of
  // neighbouring pixels, smearing colors where the photo needs space blurred.
  const planes = [new Float32Array(pixels), new Float32Array(pixels), new Float32Array(pixels)]
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const byte = pixel * 4
    planes[0][pixel] = source[byte]
    planes[1][pixel] = source[byte + 1]
    planes[2][pixel] = source[byte + 2]
  }
  const scratch = new Float32Array(pixels)
  for (const plane of planes) {
    for (let pass = 0; pass < 3; pass += 1) {
      blurAxis(plane, scratch, width, height, radius, true)
      blurAxis(scratch, plane, width, height, radius, false)
    }
  }
  const output = new Uint8ClampedArray(source.length)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    output[pixel * 4] = Math.round(planes[0][pixel])
    output[pixel * 4 + 1] = Math.round(planes[1][pixel])
    output[pixel * 4 + 2] = Math.round(planes[2][pixel])
  }
  return output
}

function parsePlate(value: string): Rgb {
  const hex = value.replace('#', '')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

// Feathered background confidence in 0..1 per pixel, or null when the mask
// clearly failed. Shared by the plate and blur presets so both agree on where
// the portrait is.
function backdropWeights(frame: ImageData): Float32Array | null {
  const mask = borderMask(frame)
  dilate(mask, frame.width, frame.height, 2)
  let background = 0
  for (let pixel = 0; pixel < mask.length; pixel += 1) background += mask[pixel]
  // A mask that covers almost nothing (busy backdrop) or almost everything
  // (no subject in frame) would print as a half-flawed plate — refuse
  // plainly instead of shipping a broken photograph.
  const coverage = background / mask.length
  if (coverage < 0.05 || coverage > 0.95) return null
  const weights = Float32Array.from(mask)
  feather(weights, frame.width, frame.height)
  return weights
}

// Replacement pixels flow home through the feathered mask; anything under a
// confident background weight takes the plate or the blurred backdrop, while
// weights near the portrait edge keep a few percent of the original.
function compositePlate(frame: ImageData, weights: Float32Array, plate: Rgb): void {
  const { data } = frame
  for (let pixel = 0, byte = 0; pixel < weights.length; pixel += 1, byte += 4) {
    const weight = weights[pixel]
    if (weight <= 0.001) continue
    data[byte] = plate[0] * weight + data[byte] * (1 - weight)
    data[byte + 1] = plate[1] * weight + data[byte + 1] * (1 - weight)
    data[byte + 2] = plate[2] * weight + data[byte + 2] * (1 - weight)
  }
}

function compositeBlur(frame: ImageData, weights: Float32Array, blurred: Uint8ClampedArray): void {
  const { data } = frame
  for (let pixel = 0, byte = 0; pixel < weights.length; pixel += 1, byte += 4) {
    const weight = weights[pixel]
    if (weight <= 0.001) continue
    data[byte] = blurred[byte] * weight + data[byte] * (1 - weight)
    data[byte + 1] = blurred[byte + 1] * weight + data[byte + 1] * (1 - weight)
    data[byte + 2] = blurred[byte + 2] * weight + data[byte + 2] * (1 - weight)
  }
}

// The studio's photos are already re-encoded to at most 480px at ingest
// (readProfilePhoto), so this full-resolution pass stays in the tens of
// milliseconds. The source is treated as read-only: re-baking always starts
// from it, so switching presets never compounds quality loss.
export function applyPhotoBackground(source: string, plate: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const ratio = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('canvas unavailable')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const frame = context.getImageData(0, 0, canvas.width, canvas.height)
        const weights = backdropWeights(frame)
        if (!weights) throw new Error('backdrop not separable')
        compositePlate(frame, weights, parsePlate(plate))
        context.putImageData(frame, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('background failed'))
      }
    }
    image.onerror = () => reject(new Error('unreadable image'))
    image.src = source
  })
}
