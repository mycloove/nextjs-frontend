import { parentPort } from 'node:worker_threads'

// Non-E2E Node adapter for the exact production module worker.
globalThis.self = { onmessage: null, postMessage: (value) => parentPort.postMessage(value) }
const loaded = import('../browserSynctex.worker.ts')
parentPort.on('message', async (data) => { await loaded; await globalThis.self.onmessage({ data }) })
