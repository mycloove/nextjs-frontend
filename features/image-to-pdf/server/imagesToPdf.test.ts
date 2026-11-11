import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { convertImagesToPdf, ImagesToPdfValidationError } from './imagesToPdf.ts'
import { FIXED_PAGE_SIZES, UNTRUSTED_MAX_LONG_SIDE, pointsToMillimetres } from '../layout/pageLayout.ts'

/* Real round trips: images made with sharp, PDFs read back with pdf-lib. */

const file = (bytes: Uint8Array, name: string, type: string) => new File([Buffer.from(bytes)], name, { type })

const photoJpeg = (width: number, height: number, quality = 90) =>
  sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .jpeg({ quality })
    .toBuffer()

const photoPng = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .png()
    .toBuffer()

/** A screenshot-like image: flat background, crisp text. */
const screenshotPng = (width = 1280, height = 720, extra: (s: sharp.Sharp) => sharp.Sharp = (s) => s) =>
  extra(
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
          `<rect width="100%" height="100%" fill="#f4f5f7"/>` +
          `<rect x="40" y="40" width="${width - 80}" height="60" fill="#2d6be4"/>` +
          `<text x="60" y="180" font-size="36" font-family="Arial" fill="#111">Invoice 2026-11 Â· Total 12,450.00</text>` +
          `<text x="60" y="240" font-size="20" font-family="Arial" fill="#333">Small print must stay sharp in the PDF.</text>` +
          `</svg>`,
      ),
    ),
  )
    .png()
    .toBuffer()

interface ImageStream {
  filter: string
  colorSpace: string
  width: number
  height: number
  contents: Uint8Array
}

async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  const images: ImageStream[] = []
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    if (object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    images.push({
      filter: object.dict.get(PDFName.of('Filter'))?.toString() ?? '',
      colorSpace: object.dict.get(PDFName.of('ColorSpace'))?.toString() ?? '',
      width: Number(object.dict.get(PDFName.of('Width'))?.toString()),
      height: Number(object.dict.get(PDFName.of('Height'))?.toString()),
      contents: object.contents,
    })
  }
  const pages = doc.getPages().map((page) => page.getSize())
  return { doc, images, pages }
}

/* The PDF's lossless stream is a PNG's IDAT data; wrap it back into a PNG and
   let sharp decode it â€” an independent check that the pixels survived. */
function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

async function decodeLossless(image: ImageStream) {
  const gray = image.colorSpace === '/DeviceGray'
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = gray ? 0 : 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from(image.contents)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return sharp(png).toColourspace(gray ? 'b-w' : 'srgb').raw().toBuffer()
}

test('a landscape photo on A4 gets a landscape page and is embedded untouched', async () => {
  const jpeg = await photoJpeg(3000, 2000)
  const result = await convertImagesToPdf([file(jpeg, 'beach.jpg', 'image/jpeg')], { pageSize: 'a4', quality: 'balanced' })
  const { pages, images } = await readPdf(result.bytes)
  assert.deepEqual(pages, [{ width: FIXED_PAGE_SIZES.a4.height, height: FIXED_PAGE_SIZES.a4.width }])
  assert.deepEqual(result.encodings, { original: 1, jpeg: 0, lossless: 0 })
  assert.equal(images[0].filter, '/DCTDecode')
  assert.equal(Buffer.compare(Buffer.from(images[0].contents), jpeg), 0, 'JPEG bytes must be byte-for-byte')
})

test('a screenshot stays lossless and pixel-exact', async () => {
  const png = await screenshotPng()
  const result = await convertImagesToPdf([file(png, 'shot.png', 'image/png')], { pageSize: 'original', quality: 'balanced' })
  const { images, pages } = await readPdf(result.bytes)
  assert.deepEqual(result.encodings, { original: 0, jpeg: 0, lossless: 1 })
  assert.equal(images.length, 1)
  assert.equal(images[0].filter, '/FlateDecode')
  assert.equal(images[0].colorSpace, '/DeviceRGB')
  const expected = await sharp(png).toColourspace('srgb').removeAlpha().raw().toBuffer()
  assert.equal(Buffer.compare(await decodeLossless(images[0]), expected), 0, 'pixels must round-trip exactly')
  assert.ok(result.bytes.length < png.length * 1.5, `PDF ${result.bytes.length} vs PNG ${png.length}`)
  // 1280 px at screen density is 960 pt â€” wider than A4, so it is held to an
  // A4-sized page with its shape kept (it used to be 1280 pt: 45 cm).
  assert.ok(Math.abs(pages[0].width - UNTRUSTED_MAX_LONG_SIDE) < 0.01)
  assert.ok(Math.abs(pages[0].width / pages[0].height - 1280 / 720) < 0.001)
})

test('a black-and-white image saved as RGB is stored as gray', async () => {
  const gray = await sharp(await screenshotPng(800, 1000)).flatten({ background: '#fff' }).toColourspace('b-w').raw().toBuffer()
  const rgb = Buffer.alloc(gray.length * 3)
  for (let i = 0; i < gray.length; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i]
  const rgbButNeutral = await sharp(rgb, { raw: { width: 800, height: 1000, channels: 3 } }).png().toBuffer()
  assert.equal((await sharp(rgbButNeutral).metadata()).channels, 3)
  const result = await convertImagesToPdf([file(rgbButNeutral, 'bw.png', 'image/png')], { pageSize: 'a4', quality: 'balanced' })
  const { images } = await readPdf(result.bytes)
  assert.equal(images[0].colorSpace, '/DeviceGray')
  assert.equal(Buffer.compare(await decodeLossless(images[0]), gray), 0)
})

test('a grayscale scan is stored as gray, not tripled into RGB', async () => {
  const gray = await screenshotPng(1000, 1400, (s) => s.flatten({ background: '#fff' }).toColourspace('b-w'))
  const result = await convertImagesToPdf([file(gray, 'scan.png', 'image/png')], { pageSize: 'a4', quality: 'balanced' })
  const { images } = await readPdf(result.bytes)
  assert.equal(images[0].filter, '/FlateDecode')
  assert.equal(images[0].colorSpace, '/DeviceGray')
})

test('a photograph saved as PNG is compressed as a photograph', async () => {
  const png = await photoPng(1600, 1200)
  const result = await convertImagesToPdf([file(png, 'photo.png', 'image/png')], { pageSize: 'a4', quality: 'balanced' })
  const { images } = await readPdf(result.bytes)
  assert.deepEqual(result.encodings, { original: 0, jpeg: 1, lossless: 0 })
  assert.equal(images[0].filter, '/DCTDecode')
  assert.ok(result.bytes.length < png.length / 2, `${result.bytes.length} vs PNG ${png.length}`)
})

test('original: a phone photo gets a printable page, not one point per pixel', async () => {
  const jpeg = await sharp(await photoJpeg(4000, 3000)).withMetadata({ density: 72 }).jpeg().toBuffer()
  const result = await convertImagesToPdf([file(jpeg, 'phone.jpg', 'image/jpeg')], { pageSize: 'original', quality: 'balanced' })
  const { pages } = await readPdf(result.bytes)
  assert.ok(Math.abs(pages[0].width - UNTRUSTED_MAX_LONG_SIDE) < 0.01)
  assert.equal(pointsToMillimetres(pages[0].width), 297)
})

test('original: a 300 dpi scan keeps its real paper size', async () => {
  const scan = await sharp(await screenshotPng(2480, 3508, (s) => s.flatten({ background: '#fff' }).toColourspace('b-w'))).withMetadata({ density: 300 }).png().toBuffer()
  const result = await convertImagesToPdf([file(scan, 'scan.png', 'image/png')], { pageSize: 'original', quality: 'high' })
  const { pages } = await readPdf(result.bytes)
  assert.equal(pointsToMillimetres(pages[0].width), 210)
  assert.equal(pointsToMillimetres(pages[0].height), 297)
})

test('EXIF rotation is applied for real, and decides the page shape', async () => {
  // Stored 400 Ã— 200, tagged "rotate 90Â° clockwise" â€” upright it is 200 Ã— 400.
  const sideways = await sharp(await photoJpeg(400, 200)).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const result = await convertImagesToPdf([file(sideways, 'portrait.jpg', 'image/jpeg')], { pageSize: 'original', quality: 'balanced' })
  const { pages, images } = await readPdf(result.bytes)
  assert.ok(pages[0].height > pages[0].width, 'portrait page')
  assert.deepEqual([images[0].width, images[0].height], [200, 400])
  assert.equal(result.encodings.jpeg, 1)
})

test('transparency is flattened onto white', async () => {
  const rgba = await sharp({ create: { width: 60, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const result = await convertImagesToPdf([file(rgba, 'clear.png', 'image/png')], { pageSize: 'original', quality: 'balanced' })
  const { images } = await readPdf(result.bytes)
  assert.equal(images[0].filter, '/FlateDecode')
  const pixels = await decodeLossless(images[0])
  assert.ok(pixels.every((value) => value === 255), 'a fully transparent image becomes white paper')
})

test('Small re-encodes a heavy JPEG and keeps it only if it is smaller', async () => {
  const heavy = await photoJpeg(2000, 1500, 98)
  const balanced = await convertImagesToPdf([file(heavy, 'a.jpg', 'image/jpeg')], { pageSize: 'a4', quality: 'balanced' })
  const small = await convertImagesToPdf([file(heavy, 'a.jpg', 'image/jpeg')], { pageSize: 'a4', quality: 'small' })
  assert.equal(balanced.encodings.original, 1)
  assert.equal(small.encodings.jpeg, 1)
  assert.ok(small.bytes.length < balanced.bytes.length * 0.8, `${small.bytes.length} vs ${balanced.bytes.length}`)

  const light = await photoJpeg(800, 600, 40)
  const smallLight = await convertImagesToPdf([file(light, 'b.jpg', 'image/jpeg')], { pageSize: 'a4', quality: 'small' })
  assert.equal(smallLight.encodings.original, 1, 'an already-light JPEG is not made worse for no gain')
})

test('oversized images are bounded, never enlarged', async () => {
  const big = await photoJpeg(6000, 4000)
  const result = await convertImagesToPdf([file(big, 'big.jpg', 'image/jpeg')], { pageSize: 'a4', quality: 'balanced' })
  const { images } = await readPdf(result.bytes)
  assert.equal(Math.max(images[0].width, images[0].height), 3508)

  const tiny = await screenshotPng(120, 80)
  const tinyResult = await convertImagesToPdf([file(tiny, 'tiny.png', 'image/png')], { pageSize: 'a4', quality: 'balanced' })
  const tinyRead = await readPdf(tinyResult.bytes)
  assert.deepEqual([tinyRead.images[0].width, tinyRead.images[0].height], [120, 80])
})

test('page order is table order, and options reach every page', async () => {
  const wide = await screenshotPng(900, 300)
  const tall = await screenshotPng(300, 900)
  const result = await convertImagesToPdf(
    [file(wide, '1.png', 'image/png'), file(tall, '2.png', 'image/png'), file(wide, '3.png', 'image/png')],
    { pageSize: 'letter', quality: 'balanced', orientation: 'auto', margin: 'none' },
  )
  const { pages } = await readPdf(result.bytes)
  assert.deepEqual(pages, [
    { width: 792, height: 612 },
    { width: 612, height: 792 },
    { width: 792, height: 612 },
  ])
})

test('an unreadable image is skipped and named; the rest still bind', async () => {
  const good = await screenshotPng(200, 100)
  const result = await convertImagesToPdf(
    [file(good, 'good.png', 'image/png'), file(new Uint8Array([1, 2, 3, 4]), 'broken.jpg', 'image/jpeg')],
    { pageSize: 'original', quality: 'balanced' },
  )
  assert.equal(result.pageCount, 1)
  assert.deepEqual(result.failed, ['broken.jpg'])
})

test('SVG is refused rather than rendered', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  await assert.rejects(
    convertImagesToPdf([file(svg, 'logo.svg', 'image/svg+xml')], { pageSize: 'original', quality: 'balanced' }),
    (error: unknown) => error instanceof ImagesToPdfValidationError && error.code === 'no_valid_images',
  )
})

test('the document is titled after its first page', async () => {
  const png = await screenshotPng(200, 100)
  const result = await convertImagesToPdf([file(png, 'Receipt March.png', 'image/png')], { pageSize: 'original', quality: 'balanced' })
  const { doc } = await readPdf(result.bytes)
  assert.equal(doc.getTitle(), 'Receipt March')
})
