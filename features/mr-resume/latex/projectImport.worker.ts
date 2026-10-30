import { createProjectZip, readProjectZip, readTexProject } from './projectArchive.ts'
import type { LatexProject } from './types.ts'

type Request = { id: string } & ({ action: 'import'; buffer: ArrayBuffer; filename: string } | { action: 'export'; project: LatexProject })
const worker = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void }
worker.onmessage = async ({ data }) => {
  try {
    if (data.action === 'export') {
      const buffer = await createProjectZip(data.project)
      worker.postMessage({ id: data.id, buffer }, [buffer])
    } else {
      const project = /\.zip$/iu.test(data.filename) ? await readProjectZip(data.buffer, data.filename.replace(/\.zip$/iu, ''))
        : readTexProject(new Uint8Array(data.buffer), data.filename, data.filename.replace(/\.tex$/iu, ''))
      for (const asset of project.assets) {
        if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot validate ZIP image assets locally. No project was imported; standalone .tex import remains available.')
        const bitmap = await createImageBitmap(asset.blob)
        try { if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 12_000_000) throw new Error(`Decoded image exceeds supported bounds: ${asset.path}. Nothing was imported.`) }
        finally { bitmap.close() }
      }
      worker.postMessage({ id: data.id, project })
    }
  } catch (error) { worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Project archive processing failed.' }) }
}
