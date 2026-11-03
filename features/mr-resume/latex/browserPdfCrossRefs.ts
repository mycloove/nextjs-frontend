import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'

/** Fresh compiler PDFs only. pdf-lib's forgiving document parser is not an xref validator. */
export function verifyCompilerCrossReferences(bytes: Uint8Array, offset: number): { root: string; live: ReadonlySet<string> } {
  const text = (start: number, length: number) => new TextDecoder('latin1').decode(bytes.subarray(start, start + length))
  const context = PDFContext.create()
  const invalid = () => new Error('The compiler PDF has invalid cross-reference structure or object offsets.')
  const entries = new Map<number, { type: number; offset: number; generation: number }>()
  const add = (id: number, type: number, objectOffset: number, generation: number) => {
    if (!Number.isSafeInteger(id) || id < 0 || id > 25_000 || entries.has(id) || ![0, 1, 2].includes(type) || !Number.isSafeInteger(objectOffset) || objectOffset < 0 || !Number.isSafeInteger(generation) || generation < 0) throw invalid()
    entries.set(id, { type, offset: objectOffset, generation })
  }
  const objectAt = (position: number) => {
    const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(text(position, 64))
    if (!header) throw invalid()
    return { id: Number(header[1]), generation: Number(header[2]), value: PDFObjectParser.forBytes(bytes.subarray(position + header[0].length), context).parseObject() }
  }
  let trailer: PDFDict
  if (/^xref\b/.test(text(offset, 16))) {
    const remaining = text(offset, bytes.length - offset)
    let cursor = 4
    while (true) {
      cursor += /^\s*/.exec(remaining.slice(cursor))![0].length
      if (remaining.slice(cursor).startsWith('trailer')) {
        const value = PDFObjectParser.forBytes(bytes.subarray(offset + cursor + 7), context).parseObject()
        if (!(value instanceof PDFDict)) throw invalid()
        trailer = value; break
      }
      const subsection = /^(\d+)\s+(\d+)[ \t]*(?:\r\n|\r|\n)/.exec(remaining.slice(cursor))
      if (!subsection) throw invalid()
      const start = Number(subsection[1]), count = Number(subsection[2])
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 1 || start + count > 25_001 || entries.size + count > 25_001) throw invalid()
      cursor += subsection[0].length
      for (let index = 0; index < count; index++) {
        const entry = /^(\d{10}) (\d{5}) ([nf])[ \t]*(?:\r\n|\r|\n)/.exec(remaining.slice(cursor))
        if (!entry) throw invalid()
        add(start + index, entry[3] === 'n' ? 1 : 0, Number(entry[1]), Number(entry[2]))
        cursor += entry[0].length
      }
    }
  } else {
    const object = objectAt(offset)
    if (!(object.value instanceof PDFRawStream) || object.value.dict.lookup(PDFName.of('Type')) !== PDFName.of('XRef')) throw invalid()
    const stream = object.value
    trailer = stream.dict
    const size = trailer.lookup(PDFName.of('Size'), PDFNumber).asNumber()
    const widths = trailer.lookup(PDFName.of('W'), PDFArray)
    if (!Number.isSafeInteger(size) || size < 2 || size > 25_001 || widths.size() !== 3) throw invalid()
    const w = Array.from({ length: 3 }, (_, index) => widths.lookup(index, PDFNumber).asNumber())
    if (w.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 4) || w.reduce((total, value) => total + value, 0) < 1) throw invalid()
    const index = trailer.lookup(PDFName.of('Index'))
    const ranges = index instanceof PDFArray ? Array.from({ length: index.size() }, (_, at) => index.lookup(at, PDFNumber).asNumber()) : [0, size]
    if (ranges.length < 2 || ranges.length > 128 || ranges.length % 2 !== 0) throw invalid()
    let count = 0
    for (let at = 0; at < ranges.length; at += 2) {
      if (!Number.isSafeInteger(ranges[at]) || !Number.isSafeInteger(ranges[at + 1]) || ranges[at] < 0 || ranges[at + 1] < 1 || ranges[at] + ranges[at + 1] > size) throw invalid()
      count += ranges[at + 1]
    }
    if (count > size) throw invalid()
    const length = stream.dict.lookup(PDFName.of('Length'), PDFNumber).asNumber()
    if (length !== stream.contents.length) throw invalid()
    const expected = count * w.reduce((total, value) => total + value, 0)
    const decoded = decodePDFRawStream(stream).getBytes(expected + 1)
    if (decoded.length !== expected) throw invalid()
    let position = 0
    const field = (width: number) => { let value = 0; for (let at = 0; at < width; at++) value = value * 256 + decoded[position++]; return value }
    for (let range = 0; range < ranges.length; range += 2) for (let at = 0; at < ranges[range + 1]; at++) {
      const type = w[0] ? field(w[0]) : 1
      add(ranges[range] + at, type, field(w[1]), field(w[2]))
    }
  }
  const size = trailer.lookup(PDFName.of('Size'), PDFNumber).asNumber()
  const root = trailer.get(PDFName.of('Root'))
  if (!Number.isSafeInteger(size) || size < 2 || size > 25_001 || !(root instanceof PDFRef) || trailer.has(PDFName.of('Prev')) || trailer.has(PDFName.of('XRefStm'))) throw invalid()
  const compressedHeaders = new Map<number, number[]>()
  for (const [id, entry] of entries) {
    if (id >= size) throw invalid()
    if (entry.type === 0) continue
    if (entry.type === 1) {
      if (entry.offset < 8 || entry.offset > offset || entry.generation > 65_535) throw invalid()
      const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(text(entry.offset, 64))
      if (!header || Number(header[1]) !== id || Number(header[2]) !== entry.generation) throw invalid()
    } else {
      const container = entries.get(entry.offset)
      if (!container || container.type !== 1) throw invalid()
      let ids = compressedHeaders.get(entry.offset)
      if (!ids) {
        const object = objectAt(container.offset)
        if (object.id !== entry.offset || !(object.value instanceof PDFRawStream) || object.value.dict.lookup(PDFName.of('Type')) !== PDFName.of('ObjStm')) throw invalid()
        const first = object.value.dict.lookup(PDFName.of('First'), PDFNumber).asNumber()
        const count = object.value.dict.lookup(PDFName.of('N'), PDFNumber).asNumber()
        if (!Number.isSafeInteger(first) || first < 1 || first > 512_000 || !Number.isSafeInteger(count) || count < 1 || count > 25_000) throw invalid()
        const header = new TextDecoder('latin1').decode(decodePDFRawStream(object.value).getBytes(first)).trim().split(/\s+/)
        if (header.length !== count * 2 || header.some((value) => !/^\d+$/.test(value))) throw invalid()
        ids = header.filter((_value, at) => at % 2 === 0).map(Number)
        compressedHeaders.set(entry.offset, ids)
      }
      if (entry.generation >= ids.length || ids[entry.generation] !== id) throw invalid()
    }
  }
  const rootEntry = entries.get(root.objectNumber)
  if (!rootEntry || rootEntry.type === 0 || (rootEntry.type === 1 ? rootEntry.generation : 0) !== root.generationNumber) throw invalid()
  const live = new Set([...entries].filter(([, entry]) => entry.type !== 0).map(([id, entry]) => PDFRef.of(id, entry.type === 1 ? entry.generation : 0).toString()))
  return { root: root.toString(), live }
}
