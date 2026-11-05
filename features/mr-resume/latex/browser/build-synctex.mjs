import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { tarEntries } from './provision.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../../../..')
const root = path.join(frontend, 'public/mr-resume/latex/busytex-v2')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Usage: node .../build-synctex.mjs <zig-0.13.0-executable> <temporary-build-directory>
// Only generated parser assets are written in the repository. No SDK is installed
// and no shared dependency/configuration is changed by this reproducible build.
export async function buildSynctex(zig, temporary) {
  assert.ok(zig && temporary, 'Supply Zig 0.13.0 and an external temporary build directory')
  const run = promisify(execFile)
  assert.equal((await run(zig, ['version'])).stdout.trim(), '0.13.0')
  await mkdir(temporary, { recursive: true })
  const offer = JSON.parse(await readFile(path.join(root, 'source-offer.json'), 'utf8'))
  const archive = offer.archives.find((entry) => entry.name === 'texlive-source.tar.gz')
  assert.equal(archive.sha256, 'aa53f7069627a20acfaa38b0104aee3ac3e23c5e220a9950e701405497cd00e1')
  const parts = await Promise.all(archive.parts.map(async (pin) => {
    const bytes = await readFile(path.join(root, pin.path))
    assert.equal(bytes.length, pin.bytes)
    assert.equal(sha256(bytes), pin.sha256)
    return bytes
  }))
  const compressed = Buffer.concat(parts)
  assert.equal(sha256(compressed), archive.sha256)
  const names = ['synctex_parser.c', 'synctex_parser.h', 'synctex_parser_advanced.h', 'synctex_parser_utils.c', 'synctex_parser_utils.h', 'synctex_version.h']
  const extracted = new Set(), sourcePins = []
  for (const entry of tarEntries(gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 }))) {
    const name = path.posix.basename(entry.path)
    if (!entry.path.includes('/texk/web2c/synctexdir/') || !names.includes(name)) continue
    assert.ok(!extracted.has(name))
    extracted.add(name)
    sourcePins.push({ path: `texk/web2c/synctexdir/${name}`, bytes: entry.content.length, sha256: sha256(entry.content) })
    await writeFile(path.join(temporary, name), entry.content)
  }
  assert.equal(extracted.size, names.length)
  await writeFile(path.join(temporary, 'zlib.h'), await readFile(path.join(here, 'synctex-memory.h')))
  await writeFile(path.join(temporary, 'syslog.h'), '#define LOG_ERR 3\n#define LOG_WARNING 4\n#define LOG_INFO 6\n#define LOG_DEBUG 7\n')
  const exported = [
    'malloc', 'free', 'mr_synctex_load', 'mr_synctex_node_count',
    'synctex_scanner_free', 'synctex_edit_query', 'synctex_display_query', 'synctex_scanner_next_result',
    'synctex_scanner_input', 'synctex_node_sibling', 'synctex_node_tag', 'synctex_scanner_get_name',
    'synctex_node_line', 'synctex_node_column', 'synctex_node_page', 'synctex_node_box_visible_h',
    'synctex_node_box_visible_v', 'synctex_node_box_visible_width', 'synctex_node_box_visible_height',
    'synctex_node_box_visible_depth', 'synctex_sheet', 'synctex_node_visible_h', 'synctex_node_visible_v',
    'synctex_node_box_height', 'synctex_node_box_depth', 'synctex_scanner_magnification',
  ]
  const outputDirectory = path.join(root, 'tools/synctex')
  await mkdir(outputDirectory, { recursive: true })
  const output = path.join(outputDirectory, 'synctex-parser.wasm')
  const args = [
    'cc', '-target', 'wasm32-wasi', '-O2', '-mexec-model=reactor', '-DSYNCTEX_USE_SYSLOG=0',
    '-I', temporary, path.join(temporary, 'synctex_parser.c'), path.join(temporary, 'synctex_parser_utils.c'),
    path.join(here, 'synctex-adapter.c'), '-Wl,--initial-memory=0x200000', '-Wl,--max-memory=0x4000000',
    '-Wl,-z,stack-size=1048576', '-Wl,--strip-all', ...exported.map((name) => `-Wl,--export=${name}`), '-o', output,
  ]
  const result = await run(zig, args, {
    cwd: temporary, timeout: 180000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(temporary, 'zig-cache'), ZIG_LOCAL_CACHE_DIR: path.join(temporary, 'zig-local-cache') },
  })
  if (result.stderr) process.stderr.write(result.stderr)
  const bytes = await readFile(output)
  const wasm = await WebAssembly.compile(bytes)
  const notices = []
  const notice = async (name, content) => {
    const relative = `tools/synctex/${name}`
    await writeFile(path.join(root, relative), content)
    notices.push({ path: relative, bytes: content.length, sha256: sha256(content) })
  }
  const parserSource = await readFile(path.join(temporary, 'synctex_parser.c'), 'utf8')
  await notice('SYNCTEX-LICENSE.txt', Buffer.from(parserSource.slice(2, parserSource.indexOf('*/')).trim() + '\n'))
  const libc = path.join(path.dirname(zig), 'lib/libc/wasi')
  for (const name of ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE-APACHE-LLVM']) await notice(`WASI-${name}.txt`, await readFile(path.join(libc, name)))
  await notice('MUSL-COPYRIGHT.txt', await readFile(path.join(libc, 'libc-top-half/musl/COPYRIGHT')))
  await notice('CLOUDLIBC-LICENSE.txt', await readFile(path.join(libc, 'libc-bottom-half/cloudlibc/LICENSE')))
  const provenance = {
    version: 1, parser: 'Upstream TeX Live SyncTeX 1.21 C parser; decoding and forward/inverse query algorithms are unmodified.',
    asset: { path: 'tools/synctex/synctex-parser.wasm', bytes: bytes.length, sha256: sha256(bytes) },
    upstream: { archive: archive.name, sha256: archive.sha256, files: sourcePins },
    adapter: { sources: ['features/mr-resume/latex/browser/build-synctex.mjs', 'features/mr-resume/latex/browser/synctex-adapter.c', 'features/mr-resume/latex/browser/synctex-memory.h'], description: 'Only the zlib read interface is adapted to a pre-decompressed bounded memory buffer. The parser has no host filesystem or network. Browser DecompressionStream enforces compressed/expanded byte caps before C runs.' },
    toolchain: { zig: '0.13.0', target: 'wasm32-wasi', windowsArchive: 'https://ziglang.org/download/0.13.0/zig-windows-x86_64-0.13.0.zip', windowsArchiveSha256: 'd859994725ef9402381e557c60bb57497215682e355204d754ee3df75ee3c158', source: 'https://ziglang.org/download/0.13.0/zig-0.13.0.tar.xz', sourceSha256: '06c73596beeccb71cc073805bdb9c0e05764128f16478fa53bf17dfabc1d4318', options: ['-O2', '-mexec-model=reactor', '--strip-all'], initialMemory: 2 * 1024 * 1024, maximumMemory: 64 * 1024 * 1024, stackBytes: 1024 * 1024 },
    notices,
  }
  await writeFile(path.join(outputDirectory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  console.log(JSON.stringify({ file: 'tools/synctex/synctex-parser.wasm', bytes: bytes.length, sha256: sha256(bytes), imports: WebAssembly.Module.imports(wasm), exports: WebAssembly.Module.exports(wasm) }, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await buildSynctex(process.argv[2], process.argv[3])
}
