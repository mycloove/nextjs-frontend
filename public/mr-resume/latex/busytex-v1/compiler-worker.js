'use strict';

// Application-owned classic worker around the unmodified pinned Emscripten
// module. Importing this file does no I/O and never compiles a document.
(function (scope) {
  const ROOT = '/mr-resume/latex/busytex-v1/';
  const VERSION = 'browser-busytex-v1-tl2023-4499aa69-r5';
  const MEMORY_HEADER = 64 * 1024 * 1024;
  const MAX_LOG = 128 * 1024;
  const MAX_PDF = 3 * 1024 * 1024;
  const MAX_SNAPSHOT = 96 * 1024 * 1024;
  const MAX_ASSETS = 256 * 1024 * 1024;
  const MAX_PACKAGE = 12 * 1024 * 1024;
  const MAX_JOB_FS = 24 * 1024 * 1024;
  const STACK_BYTES = 8 * 1024 * 1024;
  const STACK_GUARD = 0x5ea1f00d;
  const BIB_STYLES = '__mr_resume_system_bst';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const nativeFetch = scope.fetch.bind(scope);
  const engineDrivers = Object.freeze({
    pdflatex: { applet: 'pdflatex', format: 'pdftex/pdflatex.fmt', name: 'pdfLaTeX' },
    xelatex: { applet: 'xelatex', format: 'xetex/xelatex.fmt', name: 'XeLaTeX' },
    lualatex: { applet: 'luahblatex', format: 'luahbtex/luahblatex.fmt', name: 'LuaHBTeX' },
  });
  const binaryPins = Object.freeze({
    'busytex.js.bin': { bytes: 295606, sha256: 'f381d9ba816d9a4389d429f54fe85f13396aa2f822973d9b66e1f527ced3434b' },
    'busytex.wasm': { bytes: 30363063, sha256: 'a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415' },
  });
  const requiredAssets = ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz'];
  let initializing = null;
  let texRuntime = null;
  let wasmExports = null;
  let stackFloor = 0;
  let stackTop = 0;
  let baseline = null;
  let manifest = null;
  let entryPoint = null;
  let initializedEngine = null;
  let approvedGroups = [];
  let selectedPins = null;
  let snapshotIndex = null;
  let consumed = false;
  let readySent = false;
  let log = new Uint8Array(0);

  class CompileError extends Error {
    constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
  }
  const fail = (code, message, details) => { throw new CompileError(code, message, details); };
  const progress = (stage, message, details = {}) => scope.postMessage({ type: 'progress', stage, message, ...details });
  const digest = async (bytes) => Array.from(new Uint8Array(await scope.crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const assetURL = (name) => {
    if (name !== 'manifest.json' && !selectedPins?.has(name)) fail('asset_integrity', 'The compiler requested an asset outside its selected pinned bundle.');
    const origin = scope.location.origin || new URL(scope.location.href).origin;
    if (origin === 'null') fail('asset_integrity', 'Compiler assets require a secure application origin.');
    const url = new URL(ROOT + name, origin + '/');
    if (name === 'manifest.json') url.searchParams.set('profile', VERSION);
    if (url.origin !== origin) fail('asset_integrity', 'Compiler assets must use the application origin.');
    return url.href;
  };
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keysOnly = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));
  // The original indexed tools/.tex is genuine TeX data, not a public URL.
  const publicPath = (path, indexed = false) => typeof path === 'string' && path.length <= 256 && /^[A-Za-z0-9_./-]+$/.test(path)
    && !path.split('/').some((part) => !part || part === '.' || part === '..' || (!indexed && part.startsWith('.')) || part.endsWith('.'));
  const parseJSON = (content) => {
    try { return JSON.parse(decoder.decode(content)); }
    catch { fail('asset_integrity', 'A pinned compiler inventory is not valid UTF-8 JSON.'); }
  };

  function appendLog(text) {
    const incoming = encoder.encode(String(text).slice(-MAX_LOG) + '\n');
    const joined = new Uint8Array(log.length + incoming.length);
    joined.set(log); joined.set(incoming, log.length);
    if (joined.length <= MAX_LOG) { log = joined; return; }
    const notice = encoder.encode('[Earlier compiler log truncated]\n');
    let start = joined.length - (MAX_LOG - notice.length);
    while (start < joined.length && (joined[start] & 0xc0) === 0x80) start++;
    log = new Uint8Array(notice.length + joined.length - start);
    log.set(notice); log.set(joined.subarray(start), notice.length);
  }

  async function loadAsset(name, expected, observed) {
    const response = await nativeFetch(assetURL(name), { mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'force-cache' });
    if (!response.ok || response.redirected) fail('asset_unavailable', 'A pinned browser compiler asset is unavailable.');
    const limit = expected ? expected.bytes : 64 * 1024;
    const chunks = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > limit) fail('asset_integrity', 'A compiler asset exceeded its pinned size.');
          chunks.push(part.value);
          if (observed) observed(part.value.byteLength);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else {
      const content = new Uint8Array(await response.arrayBuffer());
      bytes = content.length;
      if (bytes > limit) fail('asset_integrity', 'A compiler asset exceeded its pinned size.');
      chunks.push(content);
      if (observed) observed(bytes);
    }
    const content = new Uint8Array(bytes);
    let at = 0;
    for (const chunk of chunks) { content.set(chunk, at); at += chunk.length; }
    if (expected && (bytes !== expected.bytes || await digest(content) !== expected.sha256)) fail('asset_integrity', 'A compiler asset did not match its pinned SHA-256.');
    return content;
  }

  function validateManifest(value) {
    if (!record(value) || value.version !== 1 || value.profileVersion !== VERSION || !Array.isArray(value.assets) || !Array.isArray(value.engines)) fail('asset_integrity', 'The browser compiler manifest is incompatible.');
    const ids = value.engines.map((engine) => record(engine) && engine.id);
    if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => !Object.hasOwn(engineDrivers, id))) fail('asset_integrity', 'The browser compiler profiles are incompatible.');
    if (value.assets.length !== requiredAssets.length) fail('asset_integrity', 'The browser compiler asset list is incompatible.');
    const pins = new Map();
    let totalBytes = 0;
    const addPin = (asset) => {
      if (!keysOnly(asset, ['path', 'bytes', 'sha256']) || !publicPath(asset.path) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_SNAPSHOT || typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)
        || pins.has(asset.path.toLowerCase())) fail('asset_integrity', 'The browser compiler asset pin is invalid or duplicated.');
      pins.set(asset.path.toLowerCase(), asset); totalBytes += asset.bytes;
      if (pins.size > 64 || totalBytes > MAX_ASSETS) fail('asset_integrity', 'The browser compiler assets exceed their declared limit.');
    };
    for (const asset of value.assets) {
      addPin(asset);
      if (!requiredAssets.includes(asset.path)) fail('asset_integrity', 'The browser compiler has an unknown base asset.');
      const pin = binaryPins[asset.path];
      if (pin && (asset.bytes !== pin.bytes || asset.sha256 !== pin.sha256)) fail('asset_integrity', 'The browser compiler binary pin is incompatible.');
    }
    if (Object.hasOwn(value, 'groups')) {
      if (!Array.isArray(value.groups) || !value.groups.length || value.groups.length > 29) fail('asset_integrity', 'The browser compiler group list is incompatible.');
      const groupIDs = new Set();
      for (const group of value.groups) {
        if (!keysOnly(group, ['id', 'kind', 'profiles', 'packages', 'archive', 'index', 'assets']) || Object.keys(group).length !== 7
          || typeof group.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(group.id) || groupIDs.has(group.id) || !['core', 'profile', 'package'].includes(group.kind)
          || !Array.isArray(group.profiles) || !group.profiles.length || group.profiles.length > 3 || new Set(group.profiles).size !== group.profiles.length || group.profiles.some((id) => !ids.includes(id))
          || !Array.isArray(group.packages) || group.packages.length > 128 || group.packages.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name))
          || new Set(group.packages.map((name) => name.toLowerCase())).size !== group.packages.length || (group.kind === 'package' && !group.packages.length)
          || !publicPath(group.archive) || !group.archive.startsWith('groups/' + group.id + '/') || !group.archive.endsWith('.tar.gz')
          || !publicPath(group.index) || !group.index.startsWith('groups/' + group.id + '/') || !group.index.endsWith('.json')
          || !Array.isArray(group.assets) || group.assets.length !== 2) fail('asset_integrity', 'A browser compiler group is invalid.');
        groupIDs.add(group.id);
        for (const asset of group.assets) {
          addPin(asset);
          if (![group.archive, group.index].includes(asset.path) || (group.kind === 'package' && asset.path === group.archive && asset.bytes > MAX_PACKAGE)) fail('asset_integrity', 'A compiler group contains an unknown or oversized asset.');
        }
      }
      if (!value.groups.some((group) => group.kind === 'core') || ids.some((id) => !value.groups.some((group) => group.kind === 'profile' && group.profiles.includes(id)))) fail('asset_integrity', 'The grouped compiler is missing a required core or engine profile.');
    }
    return value;
  }

  function selectGroups(value, engine, approvals) {
    if (!Array.isArray(approvals) || approvals.length > 29 || approvals.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) || new Set(approvals).size !== approvals.length) fail('invalid_request', 'The approved package group IDs are invalid or duplicated.');
    for (const id of approvals) {
      const group = value.groups?.find((item) => item.id === id);
      if (!group || group.kind !== 'package' || !group.profiles.includes(engine)) fail('invalid_request', 'Only explicitly approved package groups for the selected engine may be installed.');
    }
    return value.groups?.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(engine)) || (group.kind === 'package' && approvals.includes(group.id))) || [];
  }

  function suppliedAssets(assets, pins) {
    if (!Array.isArray(assets) || assets.length !== pins.size) fail('asset_integrity', 'Supply exactly the selected pinned compiler assets.');
    const contents = new Map();
    for (const asset of assets) {
      if (!keysOnly(asset, ['path', 'content']) || typeof asset.path !== 'string' || !pins.has(asset.path) || contents.has(asset.path)
        || !(asset.content instanceof ArrayBuffer || (asset.content instanceof Uint8Array && asset.content.buffer instanceof ArrayBuffer))) fail('asset_integrity', 'A supplied compiler asset is unsolicited, duplicated or invalid.');
      const content = asset.content instanceof Uint8Array ? asset.content : new Uint8Array(asset.content);
      if (content.byteLength !== pins.get(asset.path).bytes) fail('asset_integrity', 'A supplied compiler asset does not match its pinned size.');
      contents.set(asset.path, content);
    }
    return contents;
  }

  function validateIndex(value, inventory) {
    if (!keysOnly(value, ['version', 'root', 'unpackedBytes', 'files']) || value.version !== 1 || (Object.hasOwn(value, 'root') && value.root !== 'texlive')
      || !Number.isSafeInteger(value.unpackedBytes) || value.unpackedBytes < 1024 || value.unpackedBytes % 512 || !Array.isArray(value.files) || !value.files.length
      || inventory.unpackedBytes + value.unpackedBytes > MAX_SNAPSHOT || inventory.files + value.files.length > 6000) fail('asset_integrity', 'The package snapshot inventory exceeds its bounds or is invalid.');
    let minimumBytes = 1024;
    for (const file of value.files) {
      if (!keysOnly(file, ['path', 'bytes', 'sha256', 'source', 'upstreamPath']) || !publicPath(file.path, true) || !file.path.startsWith('texlive/')
        || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_SNAPSHOT || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)
        || ['source', 'upstreamPath'].some((key) => Object.hasOwn(file, key) && (typeof file[key] !== 'string' || file[key].length > 4096))) fail('asset_integrity', 'The package snapshot contains an invalid file pin.');
      const parts = file.path.split('/');
      for (let at = 1; at <= parts.length; at++) {
        const path = parts.slice(0, at).join('/'), alias = path.toLowerCase(), kind = at === parts.length ? 'file' : 'directory';
        const existing = inventory.paths.get(alias);
        if (existing && (existing.path !== path || existing.kind !== kind || kind === 'file')) fail('asset_integrity', 'The package groups contain duplicate files or file/directory aliases.');
        if (!existing) inventory.paths.set(alias, { path, kind });
      }
      minimumBytes += 512 + Math.ceil(file.bytes / 512) * 512;
    }
    if (minimumBytes > value.unpackedBytes) fail('asset_integrity', 'The package snapshot inventory understates its expanded size.');
    inventory.unpackedBytes += value.unpackedBytes; inventory.files += value.files.length;
    return value;
  }

  async function unpackSnapshot(bytes, index) {
    if (typeof DecompressionStream !== 'function') fail('unsupported_browser', 'This browser does not provide gzip decompression for the local TeX bundle.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > index.unpackedBytes) fail('asset_integrity', 'The package snapshot exceeded its recorded size.');
        parts.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof CompileError) throw error;
      fail('asset_integrity', 'The pinned package archive is not valid gzip data.');
    }
    finally { reader.releaseLock(); }
    if (length !== index.unpackedBytes) fail('asset_integrity', 'The package snapshot is incomplete.');
    const tar = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { tar.set(part, at); at += part.length; }
    const inventory = new Map(index.files.map((file) => [file.path, file]));
    if (inventory.size !== index.files.length || index.files.length > 6000) fail('asset_integrity', 'The package snapshot has duplicate or excessive files.');
    const files = [];
    let terminated = false;
    for (at = 0; at + 512 <= tar.length;) {
      const header = tar.subarray(at, at + 512);
      if (header.every((byte) => byte === 0)) {
        if (at + 1024 > tar.length || tar.subarray(at).some((byte) => byte !== 0)) fail('asset_integrity', 'The package snapshot has an invalid archive terminator.');
        terminated = true; break;
      }
      const text = (start, count) => {
        const field = header.subarray(start, start + count);
        if (field.some((byte) => byte > 127)) fail('asset_integrity', 'The package archive header is not supported ASCII.');
        return decoder.decode(field).replace(/\0.*$/s, '');
      };
      const pathField = (start, count) => {
        const field = header.subarray(start, start + count), end = field.indexOf(0);
        if (end >= 0 && field.subarray(end).some((byte) => byte !== 0)) fail('asset_integrity', 'The package archive has a non-canonical path field.');
        return text(start, count);
      };
      const name = [pathField(345, 155), pathField(0, 100)].filter(Boolean).join('/');
      const octal = (start, count) => {
        const value = decoder.decode(header.subarray(start, start + count));
        if (!/^ *[0-7]+[\0 ]*$/.test(value)) fail('asset_integrity', 'The package snapshot has an invalid archive number.');
        return Number.parseInt(value.trim(), 8);
      };
      const size = octal(124, 12), checksum = octal(148, 8), end = at + 512 + Math.ceil(size / 512) * 512;
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
      const pin = inventory.get(name);
      if (!pin || text(156, 1) !== '0' || text(257, 6) !== 'ustar' || text(263, 2) !== '00' || header.subarray(157, 257).some((byte) => byte !== 0)
        || sum !== checksum || !Number.isSafeInteger(size) || size !== pin.bytes || end > tar.length || !publicPath(name, true) || !name.startsWith('texlive/')
        || tar.subarray(at + 512 + size, end).some((byte) => byte !== 0)) fail('asset_integrity', 'The package snapshot contains an unsafe or unrecorded entry.');
      const content = tar.subarray(at + 512, at + 512 + size);
      if (await digest(content) !== pin.sha256) fail('asset_integrity', 'A package snapshot file did not match its SHA-256.');
      files.push({ path: '/' + name, content }); inventory.delete(name);
      at = end;
    }
    if (inventory.size || !terminated) fail('asset_integrity', 'The package snapshot inventory is incomplete.');
    return files;
  }

  function mkdir(FS, directory) {
    let current = '';
    for (const part of directory.split('/').filter(Boolean)) {
      current += '/' + part;
      if (!FS.analyzePath(current).exists) FS.mkdir(current);
    }
  }

  function initializeFS(configuration) {
    const FS = configuration.FS;
    // Kpathsea resolves argv[0]'s directory even though the executable is WASM.
    for (const directory of ['/bin', '/job', '/tmp/texmf-var', '/tmp/texmf-config', '/tmp/fontconfig', '/etc/fonts', '/etc/mr-resume']) mkdir(FS, directory);
    FS.writeFile('/bin/busytex', 'WASM program identity for kpathsea; not a native executable.\n');
    FS.writeFile('/etc/fonts/fonts.conf', '<?xml version="1.0"?><fontconfig><dir>/texlive/texmf-dist/fonts/opentype</dir><dir>/texlive/texmf-dist/fonts/truetype</dir><cachedir>/tmp/fontconfig</cachedir></fontconfig>');
    FS.writeFile('/etc/mr-resume/texmf.cnf', 'shell_escape = f\nopenin_any = p\nopenout_any = p\nparse_first_line = f\nMKTEXPK = 0\nMKTEXTFM = 0\nMKTEXFMT = 0\nMKTEXMF = 0\n');
    // Emscripten caches its native environment during initialization. Configure
    // the captured main's folder now, retaining project-root references first.
    const mainDirectory = entryPoint.slice(0, entryPoint.lastIndexOf('/') + 1);
    if (mainDirectory) configuration.ENV.TEXINPUTS = '.:/job/' + mainDirectory + '/:';
    Object.assign(configuration.ENV, {
      HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
      TEXMF: '/texlive/texmf-dist', TEXMFROOT: '/texlive', TEXMFDIST: '/texlive/texmf-dist', TEXMFVAR: '/tmp/texmf-var', TEXMFCONFIG: '/tmp/texmf-config', TEXMFHOME: '/job/texmf',
      TEXMFSYSVAR: '/texlive/texmf-dist/texmf-var', TEXMFSYSCONFIG: '/tmp/texmf-config', TEXMFCACHE: '/tmp/texmf-var',
      TEXMFCNF: '/etc/mr-resume:/texlive/texmf-dist/web2c', TEXMFLOG: '/tmp/texmf.log',
      TEXFONTMAPS: '/texlive/texmf-dist/texmf-var/fonts/map//:/texlive/texmf-dist/fonts/map//',
      BIBINPUTS: './/', BSTINPUTS: '.:' + (mainDirectory ? mainDirectory + '/:' : '') + BIB_STYLES,
      FONTCONFIG_PATH: '/etc/fonts', FONTCONFIG_FILE: 'fonts.conf',
      shell_escape: 'f', openin_any: 'p', openout_any: 'p', parse_first_line: 'f', MKTEXPK: '0', MKTEXTFM: '0', MKTEXFMT: '0', MKTEXMF: '0',
    });
    FS.chdir('/job');
  }

  function sealFS(FS) {
    // The root and all shipped packages are read-only. Only job/tmp are writable;
    // there is no NODEFS, IDBFS, WORKERFS or persistent mount.
    const readonly = (directory) => {
      for (const name of FS.readdir(directory).filter((name) => name !== '.' && name !== '..')) {
        const target = directory + '/' + name;
        if (FS.isDir(FS.stat(target).mode)) readonly(target);
        else FS.chmod(target, 0o444);
      }
      FS.chmod(directory, 0o555);
    };
    readonly('/texlive'); readonly('/etc'); readonly('/home'); readonly('/bin'); FS.chmod('/dev', 0o555); FS.chmod('/', 0o555);
    FS.ignorePermissions = false;
  }

  function checkStack() {
    if (!stackFloor) return;
    const pointer = wasmExports.stackSave();
    if (pointer < stackFloor + 64 || pointer > stackTop) fail('stack_limit', 'The compiler exceeded its isolated WASM stack budget.');
    for (let at = 0; at < 16; at++) if (texRuntime.HEAPU32[(stackFloor >>> 2) + at] !== STACK_GUARD) fail('stack_limit', 'The compiler overwrote its isolated WASM stack guard.');
  }

  function allocateStack() {
    // This release links with only 64 KiB of C stack, which fails even LuaHBTeX
    // startup. Its binary is not patched. Reserve a malloc-owned region, move
    // the exported SP, guard every host import and check the bottom canary before
    // accepting any exit/PDF. The original static-memory stack guard stays on.
    const floor = wasmExports.emscripten_builtin_memalign(16, STACK_BYTES);
    if (!Number.isInteger(floor) || floor <= wasmExports.emscripten_stack_get_base() || floor + STACK_BYTES > MEMORY_HEADER || floor % 16) fail('initialization_failed', 'The pinned compiler cannot reserve its isolated WASM stack.');
    stackFloor = floor; stackTop = floor + STACK_BYTES;
    texRuntime.HEAPU32.fill(STACK_GUARD, stackFloor >>> 2, (stackFloor >>> 2) + 16);
    wasmExports.stackRestore(stackTop);
    checkStack();
  }

  async function initialize(request) {
    const supplied = Object.hasOwn(request, 'manifest') || Object.hasOwn(request, 'assets');
    if (supplied && (!Object.hasOwn(request, 'manifest') || !Object.hasOwn(request, 'assets'))) fail('invalid_request', 'Supply both the pinned manifest and its selected asset buffers.');
    progress('loading', 'Loading the pinned local TeX compiler.');
    manifest = validateManifest(supplied ? request.manifest : parseJSON(await loadAsset('manifest.json')));
    const groups = selectGroups(manifest, initializedEngine, approvedGroups);
    const pins = manifest.groups ? [...manifest.assets.filter((asset) => ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm'].includes(asset.path)), ...groups.flatMap((group) => group.assets)] : manifest.assets;
    selectedPins = new Map(pins.map((pin) => [pin.path, pin]));
    const contents = supplied ? suppliedAssets(request.assets, selectedPins) : null;
    const byteProgress = { downloadedBytes: 0, verifiedBytes: 0, totalBytes: pins.reduce((sum, pin) => sum + pin.bytes, 0), cachedBytes: 0 };
    const reportBytes = (stage, assetPath) => progress(stage, stage === 'loading' ? 'Loading and verifying the selected pinned compiler assets.' : 'Installing the verified isolated TeX files.', { assetPath, ...byteProgress });
    const load = async (name, stage = 'loading') => {
      const pin = selectedPins.get(name);
      if (!pin) fail('asset_integrity', 'An unselected compiler asset was requested.');
      let content;
      if (contents) {
        content = contents.get(name);
        if (!content || content.byteLength !== pin.bytes || await digest(content) !== pin.sha256) fail('asset_integrity', 'A supplied compiler asset did not match its pinned SHA-256.');
      } else {
        content = await loadAsset(name, pin, (bytes) => { byteProgress.downloadedBytes += bytes; reportBytes(stage, name); });
      }
      // Parent buffers have no cache provenance in this protocol. Do not label
      // them as worker downloads or cached bytes; only this hash is observed here.
      byteProgress.verifiedBytes += content.byteLength; reportBytes(stage, name);
      return content;
    };
    await load('compiler-worker.js');
    const [scriptBytes, wasmBytes] = await Promise.all([load('busytex.js.bin'), load('busytex.wasm')]);
    const snapshots = manifest.groups ? groups.map((group) => ({ archive: group.archive, index: group.index })) : [{ archive: 'texlive.snapshot.tar.gz', index: 'snapshot-index.json' }];
    const inventory = { paths: new Map(), unpackedBytes: 0, files: 0 };
    for (const snapshot of snapshots) snapshot.inventory = validateIndex(parseJSON(await load(snapshot.index)), inventory);
    snapshotIndex = { version: 1, unpackedBytes: 0, files: [] };
    progress('initializing', 'Initializing the isolated in-memory TeX filesystem.');
    // Vendor stdout/stderr goes only into the bounded job log. Never echo source
    // or private paths to the browser's console, including Emscripten warnings.
    scope.console = Object.freeze({ log() {}, error() {}, warn() {}, info() {}, debug() {}, trace() {}, assert() {} });
    const script = scope.URL.createObjectURL(new Blob([scriptBytes], { type: 'text/javascript' }));
    try { scope.importScripts(script); }
    finally { scope.URL.revokeObjectURL(script); }
    const noNetwork = () => fail('network_disabled', 'Network and remote assets are unavailable to the local TeX engine.');
    scope.fetch = noNetwork; scope.importScripts = noNetwork;
    scope.XMLHttpRequest = noNetwork; scope.WebSocket = noNetwork; scope.EventSource = noNetwork;
    const compiledWasm = await WebAssembly.compile(wasmBytes);
    let installed, installationFailed;
    const installation = new Promise((resolve, reject) => { installed = resolve; installationFailed = reject; });
    const configuration = {
      noInitialRun: true, thisProgram: '/bin/busytex', wasmBinary: wasmBytes,
      locateFile: (name) => { if (name !== 'busytex.wasm') fail('asset_integrity', 'Unexpected compiler asset.'); return assetURL(name); },
      print: appendLog, printErr: appendLog,
      preRun: [() => {
        // The pinned loader exports run dependencies. Keep native constructors
        // and their cached ENV behind sequential, bounded archive installation.
        configuration.addRunDependency('mr-resume-snapshots');
        (async () => {
          for (const snapshot of snapshots) {
            const files = await unpackSnapshot(await load(snapshot.archive, 'initializing'), snapshot.inventory);
            for (const file of files) {
              mkdir(configuration.FS, file.path.slice(0, file.path.lastIndexOf('/')));
              configuration.FS.writeFile(file.path, file.content, { canOwn: true });
              configuration.FS.chmod(file.path, 0o444);
            }
            snapshotIndex.unpackedBytes += snapshot.inventory.unpackedBytes;
            snapshotIndex.files.push(...snapshot.inventory.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
            reportBytes('initializing', snapshot.archive);
            if (contents) contents.delete(snapshot.archive);
          }
          const format = 'texlive/texmf-dist/texmf-var/web2c/' + engineDrivers[initializedEngine].format;
          if (!snapshotIndex.files.some((file) => file.path === format)) fail('asset_integrity', 'The selected engine format is absent from the installed profile.');
          initializeFS(configuration);
          configuration.removeRunDependency('mr-resume-snapshots');
          installed();
        })().catch(installationFailed);
      }],
      instantiateWasm: (imports, receive) => {
        for (const functions of Object.values(imports)) for (const [name, implementation] of Object.entries(functions)) {
          if (typeof implementation !== 'function') continue;
          functions[name] = (...args) => {
            checkStack();
            if (/^__syscall_(?:socket|connect|accept4|bind|listen|recvfrom|sendto|getpeername|getsockname|getsockopt)$|^get(?:addrinfo|nameinfo|hostbyaddr|hostbyname)$/.test(name)) fail('network_disabled', 'Networking is unavailable to the local TeX engine.');
            return implementation(...args);
          };
        }
        const instance = new WebAssembly.Instance(compiledWasm, imports);
        wasmExports = instance.exports;
        receive(instance, compiledWasm);
        return instance.exports;
      },
    };
    try { [texRuntime] = await Promise.all([scope.busytex(configuration), installation]); }
    catch (error) { configuration.HEAPU8?.fill(0); throw error; }
    sealFS(texRuntime.FS);
    allocateStack();
    if (texRuntime.HEAPU8.length !== 512 * 1024 * 1024 || texRuntime.HEAPU8.subarray(MEMORY_HEADER).some((byte) => byte !== 0)) fail('initialization_failed', 'The pinned compiler memory layout is incompatible.');
    baseline = texRuntime.HEAPU8.slice(0, MEMORY_HEADER);
    log = new Uint8Array(0);
  }

  function safePath(path) {
    if (typeof path !== 'string' || path.length > 240 || path !== path.normalize('NFC') || path.split('/')[0].toLowerCase() === BIB_STYLES || !/^[\p{L}\p{M}\p{N}_.\/-]+$/u.test(path)
      || path.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('unsafe_path', 'A source or asset path is unsafe. Use supported relative project paths.');
    if (!/(?:\.(?:tex|sty|cls|bib|bst|md|txt|png|jpe?g)|(?:^|\/)latexmkrc)$/i.test(path)) fail('unsupported_file', 'Only TeX/text sources, inert latexmkrc data and PNG/JPEG assets are supported.');
    return path;
  }

  function validateCompile(request) {
    if (typeof request.operationKey !== 'string' || !request.operationKey || request.operationKey.length > 256) fail('invalid_request', 'The compilation identity is invalid.');
    if (!Object.hasOwn(engineDrivers, request.engine) || !manifest.engines.some((engine) => engine.id === request.engine)) fail('unsupported_engine', 'The requested engine is not supported by this pinned browser bundle.');
    if (request.engine !== initializedEngine) fail('invalid_request', 'The selected engine differs from this initialized compilation. Start a fresh compile.');
    safePath(request.mainFile);
    if (request.mainFile !== entryPoint) fail('invalid_request', 'The selected main differs from this initialized compilation. Start a fresh compile.');
    if (!/\.tex$/i.test(request.mainFile) || !Array.isArray(request.files) || !request.files.length || request.files.length > 32) fail('invalid_request', 'Select an existing main .tex file in a project with at most 32 files.');
    let sourceBytes = 0, totalBytes = 0;
    const paths = new Set();
    for (const file of request.files) {
      if (!file || typeof file !== 'object') fail('invalid_request', 'The project file record is invalid.');
      safePath(file.path);
      const alias = file.path.toLowerCase();
      if (paths.has(alias) || request.files.some((other) => other !== file && other.path && (other.path.startsWith(file.path + '/') || file.path.startsWith(other.path + '/')))) fail('duplicate_path', 'The project contains duplicate or conflicting paths.');
      paths.add(alias);
      if (typeof file.content === 'string') {
        if (!/(?:\.(?:tex|sty|cls|bib|bst|md|txt)|(?:^|\/)latexmkrc)$/i.test(file.path) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(file.content)) fail('invalid_source', 'Source must be valid Unicode TeX/text data.');
        const bytes = encoder.encode(file.content).length; sourceBytes += bytes; totalBytes += bytes;
        const source = file.content.replace(/(^|[^\\])(?:\\\\)*%[^\r\n]*/g, '$1');
        if (file.path === request.mainFile && /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b|\\(?:addbibresource|printbibliography)\b/.test(source)) fail('unsupported_bibliography', 'Biber and biblatex are not included in the browser compiler. Use the native profile or an explicit classic BibTeX project.');
      } else if (file.content instanceof Uint8Array && /\.(?:png|jpe?g)$/i.test(file.path) && file.content.length) {
        totalBytes += file.content.length;
        const image = file.content;
        if (/\.png$/i.test(file.path) ? image.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => image[index] === byte) : image.length < 3 || image[0] !== 255 || image[1] !== 216 || image[2] !== 255) fail('invalid_asset', 'An image asset does not match its PNG/JPEG format.');
      } else fail('invalid_source', 'A project file has unsupported content.');
    }
    if (!request.files.some((file) => file.path === request.mainFile && typeof file.content === 'string')) fail('missing_main', 'The main .tex file is missing.');
    if (sourceBytes > 1024 * 1024 || totalBytes > 3 * 1024 * 1024) fail('project_too_large', 'The project exceeds the 1 MiB source or 3 MiB source/asset limit.');
  }

  function packageGroupRequirement(text) {
    const missing = new Set(Array.from(text.matchAll(/File\s+[`'"]([A-Za-z0-9._-]+)\.(?:sty|cls)[`'"]\s+not found/g), (match) => match[1]));
    const groups = manifest.groups?.filter((group) => group.kind === 'package' && group.profiles.includes(initializedEngine) && !approvedGroups.includes(group.id) && group.packages.some((name) => missing.has(name))) || [];
    if (!groups.length) return null;
    return new CompileError('package_group_required', 'A missing package is available only in an explicitly approved public package group. No package was downloaded.', {
      groupIDs: groups.map((group) => group.id).sort(), packages: [...new Set(groups.flatMap((group) => group.packages))].sort(),
      downloadBytes: groups.reduce((sum, group) => sum + group.assets.reduce((bytes, asset) => bytes + asset.bytes, 0), 0),
      archiveBytes: groups.reduce((sum, group) => sum + group.assets.find((asset) => asset.path === group.archive).bytes, 0),
    });
  }

  function fileLog(FS, path) {
    if (!FS.analyzePath(path).exists) return '';
    const size = FS.stat(path).size, stream = FS.open(path, 'r');
    const bytes = new Uint8Array(Math.min(size, MAX_LOG));
    try { FS.read(stream, bytes, 0, bytes.length, Math.max(0, size - bytes.length)); }
    finally { FS.close(stream); }
    return new TextDecoder().decode(bytes);
  }

  function missingGlyphInLog(FS, filename) {
    if (!FS.analyzePath(filename).exists) return false;
    const size = FS.stat(filename).size;
    if (size > MAX_JOB_FS) fail('output_limit', 'The compiler log exceeds its temporary output budget.');
    const stream = FS.open(filename, 'r'), chunk = new Uint8Array(64 * 1024), textDecoder = new TextDecoder();
    let carry = '', position = 0;
    try {
      while (position < size) {
        const count = FS.read(stream, chunk, 0, Math.min(chunk.length, size - position), position);
        if (!count) fail('compile_failed', 'The compiler log could not be checked completely.');
        position += count;
        const text = carry + textDecoder.decode(chunk.subarray(0, count), { stream: true });
        if (/Missing character:\s*There is no/.test(text)) return true;
        carry = text.slice(-256);
      }
      return false;
    } finally { FS.close(stream); }
  }

  function call(args) {
    let exitCode;
    checkStack();
    const savedStack = wasmExports.stackSave();
    try { exitCode = texRuntime.callMain([...args]); texRuntime._flush_streams(); }
    finally {
      // BusyTeX applets keep native globals between invocations. The upstream
      // documented 64 MiB header reset is required; FS aux files remain in JS.
      let stackError;
      try { checkStack(); } catch (error) { stackError = error; }
      texRuntime.HEAPU8.fill(0); texRuntime.HEAPU8.set(baseline);
      wasmExports.stackRestore(savedStack);
      if (stackError) throw stackError;
    }
    // BibTeX status 1 means warnings (for example an omitted publisher), not an
    // error. Its fresh nonempty .bbl is required below; TeX/error statuses stay fatal.
    const bibliographyWarning = args[0] === 'bibtex8' && exitCode === 1;
    if (!Number.isInteger(exitCode) || (exitCode !== 0 && !bibliographyWarning)) fail('compile_failed', Number.isInteger(exitCode) ? `The local compiler exited with code ${exitCode}. No PDF was accepted.` : 'The local compiler did not return a valid exit status.');
    return exitCode;
  }

  function cleanup() {
    if (!texRuntime) return;
    try {
      const FS = texRuntime.FS;
      FS.chdir('/');
      const remove = (directory) => {
        for (const name of FS.readdir(directory).filter((name) => name !== '.' && name !== '..')) {
          const target = directory + '/' + name;
          if (FS.isDir(FS.lstat(target).mode)) { remove(target); FS.rmdir(target); }
          else { const node = FS.analyzePath(target).object; if (node.contents && typeof node.contents.fill === 'function') node.contents.fill(0); FS.unlink(target); }
        }
      };
      remove('/job'); remove('/tmp');
    } finally { texRuntime.HEAPU8.fill(0); if (baseline) baseline.fill(0); baseline = null; texRuntime = null; wasmExports = null; stackFloor = 0; stackTop = 0; }
  }

  function compile(request) {
    validateCompile(request);
    const FS = texRuntime.FS, driver = engineDrivers[request.engine];
    let jobWritten = 0;
    const write = FS.write;
    FS.write = function (stream, buffer, offset, length, position, canOwn) {
      if (stream.path.startsWith('/job/') || stream.path.startsWith('/tmp/')) {
        jobWritten += length;
        if (jobWritten > MAX_JOB_FS) fail('output_limit', 'The compiler exceeded its bounded temporary output budget.');
      }
      return write.call(FS, stream, buffer, offset, length, position, canOwn);
    };
    const mainDirectory = entryPoint.slice(0, entryPoint.lastIndexOf('/') + 1);
    for (const file of request.files) {
      const target = '/job/' + file.path;
      mkdir(FS, target.slice(0, target.lastIndexOf('/'))); FS.writeFile(target, file.content);
      // Main-folder \include lookups still write relative auxiliaries from /job.
      // Create output parents only; original source paths and bytes stay intact.
      if (mainDirectory && /\.tex$/i.test(file.path) && file.path.startsWith(mainDirectory)) {
        const parent = file.path.slice(mainDirectory.length, file.path.lastIndexOf('/'));
        if (parent) mkdir(FS, '/job/' + parent);
      }
    }
    // BibTeX8 applies openin_any=p to the resolved .bst path. Keep the policy
    // strict by supplying the unchanged fixed styles through a relative search
    // directory; a project's explicit local/custom style still has precedence.
    mkdir(FS, '/job/' + BIB_STYLES);
    for (const file of snapshotIndex.files.filter((file) => /^texlive\/texmf-dist\/bibtex\/bst\/(?:base|natbib)\/[^/]+\.bst$/.test(file.path))) {
      const target = '/job/' + BIB_STYLES + '/' + file.path.slice(file.path.lastIndexOf('/') + 1);
      FS.writeFile(target, FS.readFile('/' + file.path)); FS.chmod(target, 0o444);
    }
    const open = FS.open;
    FS.open = function (path, flags, mode) {
      if (typeof path === 'string' && /(?:^|\/)biblatex\.sty$/i.test(path)) fail('unsupported_bibliography', 'An included file requested biblatex, which requires an unsupported bibliography profile.');
      return open.call(FS, path, flags, mode);
    };
    const args = [driver.applet, '--no-shell-escape', '--interaction=nonstopmode', '--halt-on-error', '--file-line-error', ...(request.engine === 'lualatex' ? [] : ['--no-parse-first-line']), '--synctex=0', '--jobname=output',
      '--fmt=/texlive/texmf-dist/texmf-var/web2c/' + driver.format,
      ...(request.engine === 'xelatex' ? ['--no-pdf'] : ['--output-format=pdf']), ...(request.engine === 'lualatex' ? ['--nosocket'] : []), './' + request.mainFile];
    let bibliography = false, completed = 0;
    const rerun = /Rerun to get cross-references right|Label\(s\) may have changed|rerunfilecheck Warning: File [\s\S]*? has changed|Please rerun LaTeX|There were undefined references|Citation[^\n]*undefined/;
    let lastLog = '';
    for (let pass = 1; pass <= 3; pass++) {
      for (const extension of ['log', 'pdf', 'xdv']) if (FS.analyzePath('/job/output.' + extension).exists) FS.unlink('/job/output.' + extension);
      progress('compiling', `Running ${driver.name} pass ${pass}.`, { pass });
      appendLog(`TeX pass ${pass}: ${driver.name}`);
      let passError;
      try { call(args); } catch (error) { passError = error; }
      finally { lastLog = fileLog(FS, '/job/output.log'); appendLog(lastLog); }
      if (/biblatex\.sty[^\n]*not found/.test(lastLog) || FS.analyzePath('/job/output.bcf').exists) fail('unsupported_bibliography', 'An included file requires biblatex/Biber, which is not supported by the browser bundle.');
      if (passError) throw (passError instanceof CompileError && passError.code === 'compile_failed' ? packageGroupRequirement(lastLog) : null) || passError;
      completed = pass;
      if (missingGlyphInLog(FS, '/job/output.log')) {
        appendLog('Missing character: There is no required glyph in a requested font. Detected in the complete bounded log; no partial PDF was accepted.');
        fail('missing_glyph', 'A requested glyph is unavailable in the selected local font. No partial PDF was accepted.');
      }
      if (pass === 1 && /\\bibdata\{/.test(fileLog(FS, '/job/output.aux'))) {
        bibliography = true;
        progress('compiling', 'Running the classic BibTeX pass.');
        if (FS.analyzePath('/job/output.bbl').exists) FS.unlink('/job/output.bbl');
        try { call(['bibtex8', '--8bit', 'output.aux']); }
        finally { appendLog(fileLog(FS, '/job/output.blg')); }
        if (!FS.analyzePath('/job/output.bbl').exists || !FS.stat('/job/output.bbl').size) fail('compile_failed', 'The classic bibliography did not produce a bibliography file.');
      }
      if ((bibliography && pass < 3) || rerun.test(lastLog)) continue;
      break;
    }
    if (completed === 3 && rerun.test(lastLog)) fail('pass_limit', 'The document still needs another TeX pass after the three-pass limit. No unresolved PDF was accepted.');
    if (request.engine === 'xelatex') {
      progress('compiling', 'Converting the actual XeTeX XDV output to PDF.');
      call(['xdvipdfmx', '-D', 'false', '-o', 'output.pdf', 'output.xdv']);
    }
    if (!FS.analyzePath('/job/output.pdf').exists) fail('missing_pdf', 'The compiler did not produce a final PDF.');
    const bytes = FS.stat('/job/output.pdf').size;
    if (bytes < 5 || bytes > MAX_PDF) fail('output_limit', 'The final PDF is missing or exceeds the 3 MiB limit.');
    const pdf = FS.readFile('/job/output.pdf');
    if (![37, 80, 68, 70, 45].every((byte, index) => pdf[index] === byte)) fail('missing_pdf', 'The final compiler output is not a PDF.');
    return pdf.slice().buffer;
  }

  scope.onmessage = async function (event) {
    const request = event.data;
    if (!request || !['init', 'compile'].includes(request.type)) { scope.postMessage({ type: 'error', code: 'invalid_request', message: 'Unsupported local compiler message.' }); return; }
    try {
      if (request.type === 'init') {
        if (consumed) fail('worker_used', 'This compiler worker has already consumed its one compilation.');
        if (!keysOnly(request, ['type', 'mainFile', 'engine', 'manifest', 'assets', 'approvedGroups'])) fail('invalid_request', 'Unsupported local compiler initialization fields.');
        safePath(request.mainFile);
        const engine = request.engine === undefined ? 'pdflatex' : request.engine;
        if (!Object.hasOwn(engineDrivers, engine)) fail('unsupported_engine', 'Initialize this worker with a supported engine profile.');
        if (!/\.tex$/i.test(request.mainFile) || (entryPoint !== null && entryPoint !== request.mainFile) || (initializedEngine !== null && initializedEngine !== engine)) fail('invalid_request', 'Initialize this worker with the captured main .tex file and engine.');
        if (initializing && ['manifest', 'assets', 'approvedGroups'].some((key) => Object.hasOwn(request, key))) fail('invalid_request', 'An initialized worker cannot replace its selected assets or package approvals.');
        if (!initializing) {
          entryPoint = request.mainFile; initializedEngine = engine;
          approvedGroups = request.approvedGroups === undefined ? [] : request.approvedGroups;
          initializing = initialize(request);
        }
        await initializing;
        if (!readySent) { readySent = true; scope.postMessage({ type: 'ready', engines: manifest.engines.map((engine) => engine.id), version: VERSION }); }
        return;
      }
      if (consumed) fail('worker_used', 'This compiler worker has already consumed its one compilation.');
      consumed = true;
      if (!initializing) fail('not_initialized', 'Initialize the fixed asset bundle before compiling.');
      await initializing;
      log = new Uint8Array(0);
      let pdf;
      try { pdf = compile(request); }
      finally { cleanup(); }
      scope.postMessage({ type: 'result', operationKey: request.operationKey, engine: request.engine, exitCode: 0, pdf, log: new TextDecoder().decode(log) }, [pdf]);
    } catch (error) {
      if (request.type === 'init' && !(error instanceof CompileError)) appendLog(`Compiler initialization: ${error && error.message ? error.message : 'unknown runtime failure'}`);
      if (consumed) { try { cleanup(); } catch { /* Worker termination remains the final teardown boundary. */ } }
      scope.postMessage({ type: 'error', ...(typeof request.operationKey === 'string' ? { operationKey: request.operationKey } : {}), code: error instanceof CompileError ? error.code : request.type === 'init' ? 'initialization_failed' : 'compile_failed',
        message: error instanceof CompileError ? error.message : request.type === 'init' ? 'The pinned browser TeX compiler could not initialize.' : 'The local TeX compiler failed. No PDF was accepted.', ...(error instanceof CompileError ? error.details : {}), ...(log.length ? { log: new TextDecoder().decode(log) } : {}) });
    }
  };
})(self);
