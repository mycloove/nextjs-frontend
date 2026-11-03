/** Independent IPC adapter. Third-party engines execute only in disposable workers.
 * See browser-engine-notices.txt; the generated worker adaptation is AGPL-3.0-or-later.
 * This file does not relicense the host application or certify native isolation.
 */
import { LATEX_LIMITS } from './types.ts'
import { awaitLatexSignal, isSafeLatexPath, isWellFormedLatexText, readBoundedLatexBytes } from './server/contract.ts'

export const BROWSER_ENGINE_VERSION = 'browser-xetex-de27ed3b31a2735ea749eb523a6786578cbf4c24'
export const BROWSER_TEX_ENDPOINT = 'https://texlive.texlyre.org/'
export type BrowserEngineFile = { path: string; data: string | Uint8Array }
export type BrowserEngineProgress = { stage: 'loading' | 'compiling' | 'bibliography' | 'converting'; message: string }
type CompileInput = { mainFile: string; files: BrowserEngineFile[]; signal?: AbortSignal; onProgress?: (value: BrowserEngineProgress) => void }
type EngineKind = 'xetex' | 'pdf'
type Artifact = { name: string; url: string; sha256: string; maximum: number }
const BASE = 'https://raw.githubusercontent.com/SwiftLaTeX/SwiftLaTeX/de27ed3b31a2735ea749eb523a6786578cbf4c24/'
const ARTIFACTS: readonly Artifact[] = [
  { name: 'xeJs', url: `${BASE}swiftlatexxetex.js`, sha256: '9b21d12b1d1885e515e075125d72854283d689597e718aa83a19d8ab2280c0a0', maximum: 256 * 1024 },
  { name: 'xeWasm', url: `${BASE}swiftlatexxetex.wasm`, sha256: 'c21314edabb2d4a059dc761baddf99f7559e4146189a899cf59aa7c065f95790', maximum: 8 * 1024 * 1024 },
  { name: 'pdfJs', url: `${BASE}swiftlatexdvipdfm.js`, sha256: 'abd9ab0356f245daac0f55616ac4df52c308be38803483ab0439873ce4fd87b1', maximum: 256 * 1024 },
  { name: 'pdfWasm', url: `${BASE}swiftlatexdvipdfm.wasm`, sha256: '4a14cc6fe0e94cd445c1c1ac12cabec75f3f875b670527806da89fdadec5ca96', maximum: 8 * 1024 * 1024 },
  { name: 'format', url: `${BROWSER_TEX_ENDPOINT}xetex/10/swiftlatexxetex.fmt`, sha256: 'fecae874377a2f7cb31811e41edabbda1e19f762d00630a8faa9fb12043b5e5f', maximum: 32 * 1024 * 1024 },
]
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const OUTPUT_NAME = '__smilepdf_output.xdv'
const INPUT_BYTES = 16 * 1024 * 1024
const FONT_FILES = 16
const WORKER_NOTICE = `/* SPDX-License-Identifier: AGPL-3.0-or-later
SwiftLaTeX engine and generated worker adaptation; separate from the host IPC adapter.
Original compiler artifacts: ${BASE}
Upstream source/build snapshot immediately before the artifact publication:
https://github.com/SwiftLaTeX/SwiftLaTeX/tree/887e5438c59ccd19a6d9b728d1e21e170b208d06
https://github.com/SwiftLaTeX/SwiftLaTeX/archive/887e5438c59ccd19a6d9b728d1e21e170b208d06.tar.gz
Build uses Emscripten 3.1.46; no independent reproducible-build attestation is claimed.
License: https://raw.githubusercontent.com/SwiftLaTeX/SwiftLaTeX/87dfb950eb9c8e9dcd4ee2a3ac97fbbbacfc618a/LICENSE
The readable generated adaptation source is included in this worker Blob.
Original optional client API: EPL-2.0 OR GPL-2.0-or-later WITH Classpath-exception-2.0;
that API is not imported by this independent adapter. See browser-engine-notices.txt.
*/`

export class BrowserEngineError extends Error {
  readonly code: string
  readonly log: string
  constructor(message: string, code = 'browser_compile_failed', log = '', cause?: unknown) {
    super(message, { cause }); this.name = 'BrowserEngineError'; this.code = code; this.log = log
  }
}

export type BrowserEngineWorker = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(value: unknown, transfer?: Transferable[]): void
  terminate(): void | Promise<unknown>
}
export type BrowserEngineDependencies = {
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  createWorker?: (url: string) => BrowserEngineWorker
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  crypto?: Pick<Crypto, 'subtle'>
  timeoutMs?: number
}

function check(condition: unknown, message: string, code = 'browser_protocol_error', log = ''): asserts condition {
  if (!condition) throw new BrowserEngineError(message, code, log)
}
function boundedText(value: unknown, maximum = LATEX_LIMITS.logBytes): value is string {
  return typeof value === 'string' && value.length <= maximum && isWellFormedLatexText(value) && encoder.encode(value).byteLength <= maximum
}
function captureInput(input: CompileInput) {
  check(input && isSafeLatexPath(input.mainFile) && /\.tex$/i.test(input.mainFile), 'Choose an existing relative .tex main file.', 'browser_invalid_project')
  check(Array.isArray(input.files) && input.files.length > 0 && input.files.length <= LATEX_LIMITS.files + FONT_FILES, `Browser compilation accepts ${LATEX_LIMITS.files} project files plus ${FONT_FILES} font files.`, 'browser_invalid_project')
  const paths = new Set<string>()
  const job = input.mainFile.slice(input.mainFile.lastIndexOf('/') + 1, -4).toLowerCase()
  const outputs = new Set(['aux', 'log', 'blg', 'bbl', 'xdv', 'pdf', 'bcf', 'run.xml', 'synctex.gz', 'toc', 'out'].map((extension) => `${job}.${extension}`))
  let total = 0, source = 0, fonts = 0, projectFiles = 0
  const files = input.files.map((file) => {
    check(file && isSafeLatexPath(file.path) && !file.path.split('/').some((part) => part.startsWith('.')), 'Unsafe project filename.', 'browser_invalid_project')
    check(!file.path.split('/').some((part) => /^(?:__smilepdf_output|swiftlatexxetex|swiftlatexdvipdfm)(?:[.]|$)/i.test(part))
      && !outputs.has(file.path.split('/')[0].toLowerCase()), 'Project path conflicts with a reserved compiler or output filename.', 'browser_invalid_project')
    check(!paths.has(file.path.toLowerCase()), `Duplicate filename: ${file.path}`, 'browser_invalid_project')
    const text = /\.(?:tex|sty|cls|bib|bst|md|txt)$/i.test(file.path) || /(?:^|\/)latexmkrc$/i.test(file.path)
    const binary = /\.(?:png|jpe?g|ttf|otf)$/i.test(file.path)
    if (/\.(?:ttf|otf)$/i.test(file.path)) fonts++; else projectFiles++
    check(fonts <= FONT_FILES && projectFiles <= LATEX_LIMITS.files, 'Project or font file count exceeds the browser limit.', 'browser_invalid_project')
    check(text || binary, `Unsupported browser engine file: ${file.path}`, 'browser_invalid_project')
    check(typeof file.data === 'string' || file.data instanceof Uint8Array, 'Invalid file bytes.', 'browser_invalid_project')
    check(!binary || file.data instanceof Uint8Array && file.data.byteLength > 0, 'Images and fonts need original binary bytes.', 'browser_invalid_project')
    check(typeof file.data !== 'string' || boundedText(file.data, LATEX_LIMITS.sourceBytes), 'Invalid or oversized source text.', 'browser_invalid_project')
    check(typeof file.data === 'string' || file.data.byteLength <= INPUT_BYTES, 'File exceeds the 16 MiB browser input limit.', 'browser_invalid_project')
    const data = typeof file.data === 'string' ? file.data : new Uint8Array(file.data)
    if (text && data instanceof Uint8Array) {
      try { decoder.decode(data) } catch (cause) { throw new BrowserEngineError('Source must contain valid UTF-8.', 'browser_invalid_project', '', cause) }
    }
    const bytes = typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength
    total += bytes; if (text) source += bytes
    check(total <= INPUT_BYTES && source <= LATEX_LIMITS.sourceBytes, 'Project exceeds the 1 MiB source or 16 MiB source-plus-font input limit.', 'browser_invalid_project')
    paths.add(file.path.toLowerCase())
    return { path: file.path, data }
  })
  for (const file of files) {
    const parts = file.path.toLowerCase().split('/')
    for (let index = 1; index < parts.length; index++) check(!paths.has(parts.slice(0, index).join('/')), 'A file shadows an input directory.', 'browser_invalid_project')
  }
  check(files.some((file) => file.path === input.mainFile), 'The main file is missing from this snapshot.', 'browser_invalid_project')
  return { mainFile: input.mainFile, files }
}

/** Original glue remains hash-pinned. Only its single Module reset receives preverified WASM.
 * Source/asset bytes are messages, never interpolated into executable JavaScript.
 */
function workerSource(source: string, kind: EngineKind) {
  const marker = 'var Module={};'
  check(source.split(marker).length === 2, 'The pinned engine bootstrap no longer matches.', 'browser_artifact_integrity')
  const glue = source.replace(marker, 'var Module={wasmBinary:new Uint8Array(boot.wasm)};')
  return WORKER_NOTICE + String.raw`
self.onmessage = function(event) {
  const boot = event.data;
  const kind = ${JSON.stringify(kind)};
  const version = ${JSON.stringify(BROWSER_ENGINE_VERSION)};
  const endpoint = ${JSON.stringify(BROWSER_TEX_ENDPOINT)};
  const logLimit = ${LATEX_LIMITS.logBytes};
  const pdfLimit = ${LATEX_LIMITS.pdfBytes};
  const xdvLimit = ${LATEX_LIMITS.syncBytes};
  const inputLimit = ${INPUT_BYTES};
  const wasmName = kind === 'xetex' ? 'swiftlatexxetex.wasm' : 'swiftlatexdvipdfm.wasm';
  const wasmUrl = ${JSON.stringify(BASE)} + wasmName;
  const emit = self.postMessage.bind(self);
  const utf8 = new TextEncoder();
  let initialized = false, activeId = 0, terminal = false, stdout = '';
  const mainName = typeof boot?.mainFile === 'string' ? boot.mainFile : '';
  const job = mainName.slice(mainName.lastIndexOf('/') + 1).replace(/[.](?:tex|xdv)$/i, '');
  function limited(text) {
    if (text.length > logLimit || utf8.encode(text).byteLength > logLimit) throw new Error('Compiler diagnostic log exceeds 128 KiB.');
    return text;
  }
  Object.defineProperty(self, 'memlog', { configurable: false, get: function() { return stdout; }, set: function(value) { stdout = limited(String(value)); } });
  function exists(path) { try { return FS.stat(path).size >= 0; } catch (_) { return false; } }
  function read(path, maximum) {
    const size = FS.stat(path).size;
    if (size > maximum) throw new Error('Compiler file exceeds its byte limit: ' + path);
    return FS.readFile(path, { encoding: 'binary' });
  }
  function fullLog() {
    let text = '';
    if (kind === 'xetex') for (const suffix of ['.log', '.blg']) {
      const path = '/work/' + job + suffix;
      if (exists(path)) text += new TextDecoder('utf-8', { fatal: true }).decode(read(path, logLimit)) + '\n';
    }
    return limited(text + stdout);
  }
  function fail(error) {
    if (terminal) return;
    terminal = true;
    let log = stdout;
    try { log = fullLog(); } catch (_) {
      try { if (exists('/work/' + job + '.log')) log = new TextDecoder().decode(read('/work/' + job + '.log', logLimit)); } catch (_) {}
    }
    emit({ type: 'failure', id: activeId, code: 'browser_compile_failed', message: String(error && error.message || error).slice(0, 512), log: log });
  }
  if (!boot || boot.type !== 'init' || !(boot.wasm instanceof ArrayBuffer) || !Array.isArray(boot.files)) { fail('Invalid initialization message.'); return; }
  const NativeXHR = self.XMLHttpRequest;
  self.XMLHttpRequest = class extends NativeXHR {
    open(method, url, asynchronous) {
      const parsed = new URL(url);
      if (method !== 'GET' || parsed.origin !== new URL(endpoint).origin || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.href.length > 2048
        || !/^\/(?:xetex\/\d+\/[^/]+|fontconfig\/[^/]+\/[^/]+)$/.test(parsed.pathname)) throw new Error('Only public TeX dependency GET requests are permitted.');
      super.open('GET', parsed.href, asynchronous);
    }
    getResponseHeader(name) {
      const value = super.getResponseHeader(name);
      if (/^(?:fileid|fontid)$/i.test(name) && value != null && (!value || value === '.' || value === '..' || /[\x00-\x1f\x7f/\\:]/.test(value) || utf8.encode(value).byteLength > 240))
        throw new Error('Public dependency returned an unsafe cache filename.');
      return value;
    }
    send(body) {
      if (body != null) throw new Error('Source uploads are not permitted.');
      this.withCredentials = false;
      this.timeout = Math.max(1, Math.min(15000, boot.deadline - Date.now()));
      super.send();
      if (this.responseURL && new URL(this.responseURL).origin !== new URL(endpoint).origin) throw new Error('Public dependency redirected outside the TeX mirror.');
      if (this.response && this.response.byteLength > 8 * 1024 * 1024) throw new Error('Public TeX dependency exceeds 8 MiB.');
    }
  };
  self.fetch = async function(url, options) {
    if ((url !== wasmName && url !== wasmUrl) || options?.body != null || (options?.method && options.method !== 'GET'))
      throw new Error('Only the already-verified WASM binary can be fetched in this worker.');
    return new Response(boot.wasm.slice(0), { status: 200, headers: { 'Content-Type': 'application/wasm' } });
  };
  self.importScripts = function() { throw new Error('Runtime script imports are disabled.'); };
  function guardFilesystem() {
    const sizes = new Map(), paths = new Set();
    const inputs = new Set(boot.files.map(function(file) { return '/work/' + file.path; }));
    let total = 0;
    const nativeOpen = FS.open, nativeWrite = FS.write;
    FS.open = function() {
      const stream = nativeOpen.apply(FS, arguments);
      if (/^\/(?:work|tex)\//.test(stream.path)) {
        paths.add(stream.path);
        if (paths.size > 256) throw new Error('Compiler filesystem exceeds 256 files.');
      }
      return stream;
    };
    FS.write = function(stream, buffer, offset, length, position, canOwn) {
      if (!/^\/(?:work|tex)\//.test(stream.path)) return nativeWrite.apply(FS, arguments);
      const size = Math.max(stream.node.usedBytes || 0, (position === undefined ? stream.position : position) + length);
      const maximum = /\.fmt$/.test(stream.path) ? 32 * 1024 * 1024 : inputs.has(stream.path) ? inputLimit : /\.(?:log|blg)$/.test(stream.path) ? logLimit : /\.pdf$/.test(stream.path) ? pdfLimit : xdvLimit;
      const next = total - (sizes.get(stream.path) || 0) + size;
      if (size > maximum || next > 64 * 1024 * 1024) throw new Error('Compiler in-memory filesystem exceeds its byte budget.');
      const result = nativeWrite.apply(FS, arguments);
      sizes.set(stream.path, size); total = next;
      return result;
    };
  }
  self.postMessage = function(packet) {
    if (packet && packet.result === 'ok' && !packet.cmd && !initialized) {
      try {
        guardFilesystem();
        if (kind === 'xetex') FS.writeFile('/work/swiftlatexxetex.fmt', new Uint8Array(boot.format));
        for (const file of boot.files) {
          const parts = file.path.split('/'); parts.pop();
          let path = '/work';
          for (const part of parts) { path += '/' + part; if (!FS.analyzePath(path).exists) FS.mkdir(path); }
          FS.writeFile('/work/' + file.path, file.data);
        }
        self.texlive_endpoint = endpoint;
        initialized = true;
        emit({ type: 'ready', kind: kind, version: version });
      } catch (error) { fail(error); }
    } else if (!initialized && packet && packet.result === 'failed') fail('WASM initialization failed.');
  };
${glue}
  const nativeStderr = Module['printErr'];
  Module['printErr'] = function(message) {
    self.memlog += String(message) + '\n';
    if (nativeStderr) nativeStderr(message);
  };
  err = Module['printErr'];
  const setMain = cwrap('setMainEntry', 'number', ['string']);
  self.onmessage = function(event) {
    const request = event.data;
    if (terminal) return;
    try {
      if (!initialized || !request || request.type !== 'run' || !Number.isSafeInteger(request.id) || request.id !== activeId + 1) throw new Error('Invalid compiler command.');
      activeId = request.id;
      prepareExecutionContext();
      setMain(boot.mainFile);
      const status = kind === 'xetex' ? _compileLaTeX() : _compilePDF();
      if (status !== 0) throw new Error('Compiler exited with status ' + status + '.');
      if (kind === 'xetex') {
        if (exists('/work/' + job + '.bcf')) throw new Error('Biber is not supported by this browser XeTeX engine.');
        const auxiliary = '/work/' + job + '.aux';
        if (exists(auxiliary) && new TextDecoder().decode(read(auxiliary, xdvLimit)).includes('\\bibdata{')) {
          emit({ type: 'progress', id: activeId, stage: 'bibliography', message: 'Running classic BibTeX for this XeLaTeX pass.' });
          setMain(job + '.tex');
          const bibliographyStatus = _compileBibtex();
          if (bibliographyStatus !== 0) throw new Error('BibTeX exited with status ' + bibliographyStatus + '.');
        }
      }
      const log = fullLog();
      const bytes = read('/work/' + job + (kind === 'xetex' ? '.xdv' : '.pdf'), kind === 'xetex' ? xdvLimit : pdfLimit);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      emit({ type: 'result', id: activeId, log: log, data: data }, [data]);
    } catch (error) { fail(error); }
  };
};
`
}

/** Cache contains only verified, public upstream bytes. No source, font upload or worker is cached. */
export function createBrowserXeTeXEngine(dependencies: BrowserEngineDependencies = {}) {
  const cache = new Map<string, Uint8Array<ArrayBuffer>>()
  const request = dependencies.fetch ?? ((url: string, init: RequestInit) => fetch(url, init))
  const createUrl = dependencies.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revokeUrl = dependencies.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url))
  const createWorker = dependencies.createWorker ?? ((url: string) => new Worker(url))
  const crypto = () => dependencies.crypto ?? globalThis.crypto

  function platform() {
    check(typeof globalThis.WebAssembly?.compile === 'function' && (dependencies.createWorker || typeof Worker === 'function')
      && (dependencies.createObjectURL || typeof globalThis.URL?.createObjectURL === 'function') && (dependencies.fetch || typeof fetch === 'function') && crypto()?.subtle,
    'Browser XeTeX requires Worker, WebAssembly and secure-context SHA-256 support.', 'browser_unavailable')
  }
  async function operation<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal, deadline: number, cleanup: Set<() => Promise<void>>) => Promise<T>) {
    const controller = new AbortController(), cleanup = new Set<() => Promise<void>>()
    const abort = () => controller.abort()
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
    const timeout = Math.min(dependencies.timeoutMs ?? 120_000, 120_000)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
    try {
      if (controller.signal.aborted) throw new DOMException('Browser compilation was cancelled.', 'AbortError')
      platform()
      return await awaitLatexSignal(work(controller.signal, Date.now() + timeout, cleanup), controller.signal)
    } catch (cause) {
      if (timedOut) throw new BrowserEngineError('Browser compilation exceeded its 120-second deadline and its worker was terminated.', 'browser_timeout', '', cause)
      if (controller.signal.aborted) throw new DOMException('Browser compilation was cancelled and its worker was terminated.', 'AbortError')
      if (cause instanceof BrowserEngineError) throw cause
      throw new BrowserEngineError('Browser compiler failed. The source snapshot is unchanged.', 'browser_compile_failed', '', cause)
    } finally {
      clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort)
      await Promise.all([...cleanup].map((close) => close()))
    }
  }
  async function assets(signal: AbortSignal) {
    await Promise.all(ARTIFACTS.map(async (artifact) => {
      if (cache.has(artifact.name)) return
      let response: Response | undefined
      try {
        response = await awaitLatexSignal(request(artifact.url, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'force-cache', signal }), signal)
        check(response.status === 200 && !response.redirected, `Public compiler artifact is unavailable: ${artifact.name}`, 'browser_artifact_unavailable')
        const buffer = await readBoundedLatexBytes(response, artifact.maximum, signal)
        const digest = new Uint8Array(await awaitLatexSignal(crypto().subtle.digest('SHA-256', buffer), signal))
        check(Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') === artifact.sha256, `Public compiler artifact failed SHA-256: ${artifact.name}`, 'browser_artifact_integrity')
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        cache.set(artifact.name, new Uint8Array(buffer))
      } catch (cause) {
        if (signal.aborted || cause instanceof BrowserEngineError) throw cause
        throw new BrowserEngineError(`Could not download and verify public compiler artifact: ${artifact.name}`, 'browser_artifact_unavailable', '', cause)
      } finally { if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {}) }
    }))
    return Object.fromEntries(cache) as Record<'xeJs' | 'xeWasm' | 'pdfJs' | 'pdfWasm' | 'format', Uint8Array<ArrayBuffer>>
  }

  function session(kind: EngineKind, source: Uint8Array, signal: AbortSignal, cleanup: Set<() => Promise<void>>, onProgress?: CompileInput['onProgress']) {
    const url = createUrl(new Blob([workerSource(decoder.decode(source), kind)], { type: 'text/javascript' }))
    let worker: BrowserEngineWorker
    try { worker = createWorker(url) } catch (cause) { revokeUrl(url); throw new BrowserEngineError('Worker creation failed; check browser memory and worker-src policy.', 'browser_unavailable', '', cause) }
    let closing: Promise<void> | undefined, fatal: BrowserEngineError | undefined
    let waiter: { type: 'ready' | 'result'; id: number; resolve: (value: Record<string, unknown>) => void; reject: (cause: unknown) => void; clean: () => void } | undefined
    const close = () => closing ??= (async () => {
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
      try { await worker.terminate() } finally { revokeUrl(url) }
    })()
    cleanup.add(close)
    const reject = (cause: BrowserEngineError) => { fatal = cause; const pending = waiter; waiter = undefined; pending?.clean(); pending?.reject(cause); void close() }
    worker.onerror = (event) => { event.preventDefault?.(); reject(new BrowserEngineError('Browser engine crashed or ran out of memory.', 'browser_engine_crashed')) }
    worker.onmessageerror = () => reject(new BrowserEngineError('Browser engine returned an unreadable message.', 'browser_protocol_error'))
    worker.onmessage = ({ data }) => {
      try {
        check(data && typeof data === 'object' && !Array.isArray(data) && waiter, 'Unexpected browser worker message.')
        const value = data as Record<string, unknown>
        const keys = Object.keys(value).sort().join(',')
        if (value.type === 'progress') {
          check(keys === 'id,message,stage,type' && waiter.type === 'result' && value.id === waiter.id && value.stage === 'bibliography' && boundedText(value.message, 256), 'Malformed browser progress message.')
          onProgress?.({ stage: 'bibliography', message: value.message }); return
        }
        if (value.type === 'failure') {
          check(keys === 'code,id,log,message,type' && value.id === waiter.id && value.code === 'browser_compile_failed' && boundedText(value.message, 512) && boundedText(value.log), 'Malformed browser failure message.')
          throw new BrowserEngineError(value.message, value.code, value.log)
        }
        if (waiter.type === 'ready') check(keys === 'kind,type,version' && value.type === 'ready' && value.kind === kind && value.version === BROWSER_ENGINE_VERSION, 'Mismatched browser engine initialization.')
        else check(keys === 'data,id,log,type' && value.type === 'result' && value.id === waiter.id && value.data instanceof ArrayBuffer && boundedText(value.log), 'Malformed browser compiler result.')
        const pending = waiter; waiter = undefined; pending.clean(); pending.resolve(value)
      } catch (cause) { reject(cause instanceof BrowserEngineError ? cause : new BrowserEngineError('Invalid browser worker response.', 'browser_protocol_error', '', cause)) }
    }
    function exchange(type: 'ready' | 'result', id: number, message: unknown, transfer: Transferable[] = []) {
      return new Promise<Record<string, unknown>>((resolve, fail) => {
        if (fatal) { fail(fatal); return }
        if (closing || signal.aborted) { fail(new DOMException('Browser compilation was cancelled.', 'AbortError')); return }
        check(!waiter, 'Concurrent browser worker command.')
        const abort = () => { const pending = waiter; waiter = undefined; pending?.clean(); pending?.reject(new DOMException('Browser compilation was cancelled.', 'AbortError')); void close() }
        waiter = { type, id, resolve, reject: fail, clean: () => signal.removeEventListener('abort', abort) }
        signal.addEventListener('abort', abort, { once: true })
        try { worker.postMessage(message, transfer) } catch (cause) { reject(new BrowserEngineError('Could not deliver browser engine input.', 'browser_protocol_error', '', cause)) }
      })
    }
    return { exchange, close }
  }

  const checkBrowserEngineAvailability = (signal?: AbortSignal): Promise<void> => operation(signal, async (signal) => { await assets(signal) })
  async function compileBrowserXeTeX(input: CompileInput): Promise<{ pdf: Uint8Array; log: string }> {
    if (input?.signal?.aborted) throw new DOMException('Browser compilation was cancelled.', 'AbortError')
    // Capture original bytes before any fetch, progress callback or await can race edits.
    const captured = captureInput(input)
    return operation(input.signal, async (signal, deadline, cleanup) => {
      input.onProgress?.({ stage: 'loading', message: 'Downloading and verifying public XeTeX compiler artifacts.' })
      const publicAssets = await assets(signal)
      const xe = session('xetex', publicAssets.xeJs, signal, cleanup, input.onProgress)
      const wasm = publicAssets.xeWasm.slice().buffer, format = publicAssets.format.slice().buffer
      await xe.exchange('ready', 0, { type: 'init', mainFile: captured.mainFile, files: captured.files, wasm, format, deadline }, [wasm, format])
      let result: Record<string, unknown> | undefined
      for (let pass = 1; pass <= 3; pass++) {
        input.onProgress?.({ stage: 'compiling', message: `Running XeLaTeX pass ${pass} of 3.` })
        result = await xe.exchange('result', pass, { type: 'run', id: pass })
        const bytes = new Uint8Array(result.data as ArrayBuffer)
        check(bytes.byteLength >= 16 && bytes.byteLength <= LATEX_LIMITS.syncBytes && bytes[0] === 247 && bytes[1] === 7, 'XeTeX did not return bounded XDV bytes.', 'browser_invalid_xdv', result.log as string)
      }
      const xdv = new Uint8Array(result!.data as ArrayBuffer), xeLog = result!.log as string
      // Release the ~297 MiB Xe heap before starting the independent PDF converter.
      await xe.close()
      input.onProgress?.({ stage: 'converting', message: 'Converting XeTeX XDV into actual PDF bytes.' })
      const pdf = session('pdf', publicAssets.pdfJs, signal, cleanup, input.onProgress)
      const pdfWasm = publicAssets.pdfWasm.slice().buffer
      await pdf.exchange('ready', 0, { type: 'init', mainFile: OUTPUT_NAME, files: [...captured.files, { path: OUTPUT_NAME, data: xdv }], wasm: pdfWasm, deadline }, [pdfWasm])
      const converted = await pdf.exchange('result', 1, { type: 'run', id: 1 })
      const bytes = new Uint8Array(converted.data as ArrayBuffer)
      const log = xeLog + '\n' + converted.log
      check(boundedText(log), 'Complete compiler log exceeds 128 KiB; no proof was accepted.', 'browser_log_limit')
      check(bytes.byteLength >= 16 && bytes.byteLength <= LATEX_LIMITS.pdfBytes && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
        && new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF'), 'Converter did not return bounded, complete PDF bytes.', 'browser_invalid_pdf', log)
      return { pdf: bytes, log }
    })
  }
  return { checkBrowserEngineAvailability, compileBrowserXeTeX }
}

// Importing the adapter starts no worker, network request or source compilation.
const engine = createBrowserXeTeXEngine()
export const checkBrowserEngineAvailability = engine.checkBrowserEngineAvailability
export const compileBrowserXeTeX = engine.compileBrowserXeTeX
