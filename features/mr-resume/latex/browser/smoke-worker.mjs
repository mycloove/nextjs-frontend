import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'

// This is an asset adapter, not a compiler substitute. The exact deployed
// classic worker and unmodified Emscripten/WASM run in a worker-only VM: no
// process, require, Node filesystem or network APIs are exposed to TeX.
const root = '/mr-resume/latex/busytex-v1/'
const origin = 'https://mr-resume.invalid'
const manifest = JSON.parse(readFileSync(path.join(workerData.staticDirectory, 'manifest.json'), 'utf8'))
const profileVersion = manifest.profileVersion
const basePaths = ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz']
const pinnedPaths = new Set(manifest.assets.map((asset) => {
  if (!basePaths.includes(asset.path)) throw new Error('Unknown base asset in the smoke manifest')
  return asset.path
}))
for (const group of manifest.groups || []) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(group.id) || !Array.isArray(group.assets) || group.assets.length !== 2) throw new Error('Invalid pinned smoke asset group')
  for (const asset of group.assets) {
    if (typeof asset.path !== 'string' || !asset.path.startsWith(`groups/${group.id}/`) || !/^[A-Za-z0-9_./-]+$/.test(asset.path)
      || asset.path.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.')) || ![group.archive, group.index].includes(asset.path)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !/^[0-9a-f]{64}$/.test(asset.sha256) || pinnedPaths.has(asset.path)) throw new Error('Unsafe or duplicate pinned smoke group asset')
    pinnedPaths.add(asset.path)
  }
}
const requests = [], scripts = [], consoleLines = []
const blobs = new Map()
class AssetBlob extends Blob {
  constructor(parts, options) {
    super(parts, options)
    this.sourceBytes = Buffer.concat(parts.map((part) => typeof part === 'string' ? Buffer.from(part) : ArrayBuffer.isView(part) ? Buffer.from(part.buffer, part.byteOffset, part.byteLength) : Buffer.from(part)))
  }
}
class AssetURL extends URL {
  static createObjectURL(blob) { const url = `blob:${origin}/checked-asset-${blobs.size}`; blobs.set(url, blob); return url }
  static revokeObjectURL(url) { blobs.delete(url) }
}
const localAsset = (input) => {
  const url = new URL(String(input), origin)
  const name = url.pathname.slice(root.length)
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(root) || (url.search && !(name === 'manifest.json' && url.search === `?profile=${encodeURIComponent(profileVersion)}`)) || url.hash
    || !(name === 'manifest.json' || pinnedPaths.has(name))) throw new Error('The smoke worker requested a non-pinned or remote asset')
  return { name, filename: path.join(workerData.staticDirectory, name) }
}
const sandbox = {
  location: { origin, href: 'blob:' + origin + '/checked-worker-bootstrap' },
  URL: AssetURL, TextEncoder, TextDecoder, Blob: AssetBlob, Response, DecompressionStream,
  Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
  WebAssembly, crypto: webcrypto, performance, setTimeout, clearTimeout,
  console: Object.fromEntries(['log', 'error', 'warn', 'info', 'debug', 'trace', 'assert'].map((name) => [name, (...values) => consoleLines.push(values.map(String).join(' '))])),
  fetch: async (input, options) => {
    if (workerData.noNetwork) throw new Error('Supplied-asset initialization must not fetch any asset')
    const asset = localAsset(input)
    if (options.mode !== 'same-origin' || options.credentials !== 'omit' || options.redirect !== 'error' || options.cache !== 'force-cache' || options.body !== undefined || (options.method && options.method !== 'GET')) throw new Error('Unsafe worker asset fetch options')
    requests.push(asset.name)
    const bytes = readFileSync(asset.filename)
    const response = new Response(bytes, { status: 200, headers: { 'Content-Type': asset.name.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
    if (workerData.tamper === asset.name) {
      bytes[0] ^= 1
      return new Response(bytes, { status: 200 })
    }
    return response
  },
  postMessage: (value, transfer = []) => parentPort.postMessage({ kind: 'message', value, requests: [...requests], scripts: [...scripts], consoleLines: [...consoleLines] }, transfer),
}
sandbox.self = sandbox
const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: true } })
sandbox.importScripts = (...inputs) => {
  for (const input of inputs) {
    const blob = blobs.get(input)
    if (!blob || blob.type !== 'text/javascript' || !blob.sourceBytes.equals(readFileSync(path.join(workerData.staticDirectory, 'busytex.js.bin')))) throw new Error('Only the exact pinned Emscripten bytes may be imported as a local Blob')
    scripts.push('busytex.js.bin')
    vm.runInContext(blob.sourceBytes.toString('utf8'), context, { filename: 'busytex.js.bin' })
  }
}
vm.runInContext(readFileSync(path.join(workerData.staticDirectory, 'compiler-worker.js'), 'utf8'), context, { filename: 'compiler-worker.js' })
parentPort.postMessage({ kind: 'boot', requests: [...requests], scripts: [...scripts], consoleLines: [...consoleLines] })
parentPort.on('message', async (data) => {
  try { await context.onmessage({ data }) }
  catch (error) { parentPort.postMessage({ kind: 'harness-error', message: error.message }) }
})
