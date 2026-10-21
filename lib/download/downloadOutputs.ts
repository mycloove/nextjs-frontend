'use client'

import JSZip from 'jszip'

/**
 * Shared download helpers. Kept deliberately tiny: each tool keeps its own
 * visual identity, but the *mechanics* of saving output (single file direct,
 * many files collapsed into one ZIP) should behave identically everywhere.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Reclaim the object URL; the download has started once the click lands.
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export interface OutputFile {
  name: string
  blob: Blob
}

/**
 * One output → direct download; several outputs → a single ZIP so the user
 * gets one predictable save instead of a browser popup-per-file barrage.
 */
export async function downloadOutputs(files: OutputFile[], zipName: string): Promise<void> {
  if (files.length === 1) {
    downloadBlob(files[0].blob, files[0].name)
    return
  }

  const zip = new JSZip()
  const used = new Set<string>()
  for (const file of files) {
    let name = file.name
    // ZIP entries must be unique; a flattened multi-file export from any tool
    // commonly collides on repeated base names (page-1.png, page-1.png …).
    let n = 2
    while (used.has(name)) {
      const dot = file.name.lastIndexOf('.')
      name = dot > 0
        ? `${file.name.slice(0, dot)}-${n}${file.name.slice(dot)}`
        : `${file.name}-${n}`
      n += 1
    }
    used.add(name)
    zip.file(name, file.blob)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  downloadBlob(blob, zipName)
}
