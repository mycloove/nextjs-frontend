import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { downloads, sha256, tarEntries } from './provision.mjs'

// Provisioning only: rebuild the native release's incompatible Lua bytecode
// format with the actual unmodified 32-bit WASM engine. This is NEVER imported
// by the worker; init at runtime only loads the resulting pinned snapshot.
const [command, cache] = process.argv.slice(2)
if (command !== '--generate' || !cache || !path.isAbsolute(cache)) throw new Error('Use --generate with an absolute temporary cache directory')
const epoch = 1708041600000
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [epoch])) }
  static now() { return epoch }
}
const logs = []
const append = (text) => { logs.push(String(text)); if (logs.length > 1000) logs.shift() }
const noNetwork = () => { throw new Error('Network is disabled during fixed format provisioning') }
const sandbox = {
  self: null, location: { origin: 'https://mr-resume.invalid', href: 'https://mr-resume.invalid/busytex.js' },
  URL, TextEncoder, TextDecoder, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
  WebAssembly, crypto: webcrypto, Date: FixedDate, performance, setTimeout, clearTimeout,
  fetch: noNetwork, importScripts: noNetwork, XMLHttpRequest: noNetwork, WebSocket: noNetwork,
  console: Object.fromEntries(['log', 'error', 'warn', 'info', 'debug', 'trace', 'assert'].map((name) => [name, () => {}])),
}
sandbox.self = sandbox
const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: true } })
const javascript = await readFile(path.join(cache, 'busytex.js'))
const wasm = await readFile(path.join(cache, 'busytex.wasm'))
for (const [name, bytes] of [['busytex.js', javascript], ['busytex.wasm', wasm]]) assert.equal(sha256(bytes), downloads.find((item) => item.name === name).sha256)
vm.runInContext(javascript.toString('utf8'), context, { filename: 'busytex.js' })
const basicArchive = await readFile(path.join(cache, 'texlive-basic.tar.gz'))
assert.equal(sha256(basicArchive), downloads.find((item) => item.name === 'texlive-basic.tar.gz').sha256)
const files = tarEntries(gunzipSync(basicArchive)).filter((item) => item.path.startsWith('build/texlive-basic/texmf-dist/') && !item.path.endsWith('.fmt') && !item.path.includes('/doc/') && !item.path.includes('/source/'))
  .map((item) => ({ path: item.path.replace(/^build\/texlive-basic\//, 'texlive/'), content: item.content }))
const mkdir = (FS, directory) => {
  let current = ''
  for (const name of directory.split('/').filter(Boolean)) { current += '/' + name; if (!FS.analyzePath(current).exists) FS.mkdir(current) }
}
const compiled = await WebAssembly.compile(wasm)
let exports, runtime, stackFloor = 0, stackTop = 0
const checkStack = () => {
  if (!stackFloor) return
  const pointer = exports.stackSave()
  assert.ok(pointer >= stackFloor + 64 && pointer <= stackTop, 'Format compiler stack budget exceeded')
  for (let at = 0; at < 16; at++) assert.equal(runtime.HEAPU32[(stackFloor >>> 2) + at], 0x5ea1f00d, 'Format compiler stack canary changed')
}
const configuration = {
  noInitialRun: true, thisProgram: '/bin/busytex', wasmBinary: new Uint8Array(wasm), print: append, printErr: append,
  preRun: [() => {
    const FS = configuration.FS
    for (const item of files) { const filename = '/' + item.path; mkdir(FS, path.posix.dirname(filename)); FS.writeFile(filename, new Uint8Array(item.content)) }
    for (const directory of ['/bin', '/format-job', '/tmp/texmf-var', '/tmp/texmf-config', '/tmp/fontconfig', '/etc/fonts', '/etc/mr-resume']) mkdir(FS, directory)
    FS.writeFile('/bin/busytex', 'WASM program identity, not a native executable.\n')
    FS.writeFile('/etc/fonts/fonts.conf', '<fontconfig><dir>/texlive/texmf-dist/fonts/opentype</dir><dir>/texlive/texmf-dist/fonts/truetype</dir><cachedir>/tmp/fontconfig</cachedir></fontconfig>')
    FS.writeFile('/etc/mr-resume/texmf.cnf', 'shell_escape = f\nopenin_any = p\nopenout_any = p\nMKTEXFMT = 0\nMKTEXPK = 0\nMKTEXTFM = 0\nMKTEXMF = 0\n')
    Object.assign(configuration.ENV, {
      HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SOURCE_DATE_EPOCH: String(epoch / 1000), FORCE_SOURCE_DATE: '1',
      TEXMF: '/texlive/texmf-dist', TEXMFROOT: '/texlive', TEXMFDIST: '/texlive/texmf-dist', TEXMFVAR: '/tmp/texmf-var', TEXMFCONFIG: '/tmp/texmf-config', TEXMFCACHE: '/tmp/texmf-var',
      TEXMFSYSVAR: '/tmp/texmf-var', TEXMFSYSCONFIG: '/tmp/texmf-config', TEXMFCNF: '/etc/mr-resume:/texlive/texmf-dist/web2c',
      TEXFONTMAPS: '/texlive/texmf-dist/texmf-var/fonts/map//:/texlive/texmf-dist/fonts/map//', FONTCONFIG_PATH: '/etc/fonts', FONTCONFIG_FILE: 'fonts.conf',
      shell_escape: 'f', openin_any: 'p', openout_any: 'p', MKTEXFMT: '0', MKTEXPK: '0', MKTEXTFM: '0', MKTEXMF: '0',
    })
    FS.chdir('/format-job')
  }],
  instantiateWasm: (imports, receive) => {
    for (const functions of Object.values(imports)) for (const [name, implementation] of Object.entries(functions)) if (typeof implementation === 'function') {
      functions[name] = (...args) => { checkStack(); if (/socket|connect|sendto|recvfrom|getaddrinfo|gethostby/.test(name)) noNetwork(); return implementation(...args) }
    }
    const instance = new WebAssembly.Instance(compiled, imports)
    exports = instance.exports; receive(instance, compiled); return instance.exports
  },
}
runtime = await context.busytex(configuration)
stackFloor = exports.emscripten_builtin_memalign(16, 8 * 1024 * 1024); stackTop = stackFloor + 8 * 1024 * 1024
assert.ok(stackFloor > exports.emscripten_stack_get_base() && stackTop <= 64 * 1024 * 1024)
runtime.HEAPU32.fill(0x5ea1f00d, stackFloor >>> 2, (stackFloor >>> 2) + 16)
exports.stackRestore(stackTop)
console.log('FORMAT BUILD: pinned LuaHBTeX 1.16.0 WASM initex, fixed source epoch 2024-02-16, no native compiler or network.')
try {
  const exitCode = runtime.callMain(['luahbtex', '--ini', '--no-shell-escape', '--nosocket', '--interaction=nonstopmode', '--halt-on-error', '--file-line-error', '--jobname=luahblatex', 'lualatex.ini'])
  runtime._flush_streams(); checkStack()
  if (exitCode !== 0) throw new Error(`WASM initex exit ${exitCode}`)
  const filename = '/format-job/luahblatex.fmt'
  assert.ok(runtime.FS.analyzePath(filename).exists, 'Actual initex did not produce the .fmt')
  const format = runtime.FS.readFile(filename)
  assert.ok(format.length > 1024 && format.length < 32 * 1024 * 1024)
  await writeFile(path.join(cache, 'luahblatex-wasm32.fmt'), format)
  await writeFile(path.join(cache, 'luahblatex-wasm32.provenance.json'), JSON.stringify({ version: 1, engine: 'LuaHBTeX 1.16.0 / TeX Live 2023.0', binarySHA256: sha256(wasm), sourceArchiveSHA256: sha256(basicArchive), sourceEpoch: epoch / 1000, bytes: format.length, sha256: sha256(format), method: 'actual unmodified pinned WASM luahbtex --ini lualatex.ini; native .fmt files excluded from the provisioning filesystem' }, null, 2) + '\n')
  console.log(`FORMAT PASS: ${format.length} bytes, SHA-256 ${sha256(format)}`)
} catch (error) { console.error(logs.join('\n').slice(-128 * 1024)); throw error }
finally { runtime.HEAPU8.fill(0) }
