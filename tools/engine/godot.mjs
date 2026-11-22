// Godot 3.x/4.x static adapter: PCK discovery/validation/normalization, project settings, runner identity and
// web-runtime requirements/blockers. Static only; no runner is ever executed. Format facts follow the public
// engine source (core/io/file_access_pack.{h,cpp}, editor export): PCK format 1 = Godot 3, format 2 = Godot 4.0-4.4.
import { createHash } from 'node:crypto';

export const sha256 = b => createHash('sha256').update(b).digest('hex');
const md5 = b => createHash('md5').update(b).digest('hex');
const MAGIC = Buffer.from('GDPC');
const MAX_INPUT = 2 * 1024 ** 3;
const PACK_DIR_ENCRYPTED = 1, PACK_REL_FILEBASE = 2, PACK_FILE_ENCRYPTED = 1, PACK_FILE_REMOVAL = 2;
function fail(message) { throw new Error('godot: ' + message); }
function integer64(b, at) {
  const n = b.readBigUInt64LE(at);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('unsafe 64-bit directory value');
  return Number(n);
}
/** "x.y" for x.y.0, as Godot's tags, runtime ids and runner strings write it. */
export const versionName = (major, minor, patch) => patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;

/** PE section named "pck" (Godot 4 Windows embeds there; the header may be up to 8 bytes in). */
function peSection(input) {
  if (input.length < 64 || input.toString('latin1', 0, 2) !== 'MZ') return null;
  const pe = input.readUInt32LE(60);
  if (pe + 24 > input.length || input.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  const count = input.readUInt16LE(pe + 6), optional = input.readUInt16LE(pe + 20), table = pe + 24 + optional;
  for (let i = 0; i < count && table + 40 * (i + 1) <= input.length; i++) {
    const at = table + 40 * i, name = input.toString('latin1', at, at + 8).replace(/\0+$/, '');
    if (name !== 'pck') continue;
    const size = input.readUInt32LE(at + 16), raw = input.readUInt32LE(at + 20);
    for (let k = 0; k < 8; k++) if (input.subarray(raw + k, raw + k + 4).equals(MAGIC)) return { start: raw + k, end: Math.min(input.length, raw + size) };
  }
  return null;
}

/** Header at zero, the final 12-byte trailer, or a PE "pck" section: incidental GDPC strings are not packs. */
export function locatePack(input) {
  if (input.length > MAX_INPUT) fail('input exceeds 2 GiB adapter limit');
  if (input.subarray(0, 4).equals(MAGIC)) return { start: 0, end: input.length, location: 'standalone' };
  if (input.length >= 12 && input.subarray(-4).equals(MAGIC)) {
    const end = input.length - 12, size = integer64(input, end), start = end - size;
    if (size < 88 || start < 0 || !input.subarray(start, start + 4).equals(MAGIC)) fail('invalid appended GDPC trailer bounds/header');
    return { start, end, location: 'embedded-trailer' };
  }
  const section = peSection(input);
  if (section) return { ...section, location: 'embedded-section' };
  fail('no GDPC header, appended trailer or pck section');
}
/** Cheap probe for inspect: does this file carry a pack, and where? Never throws. */
export function probePack(input) {
  try { return locatePack(input); } catch { return null; }
}

function readDirectory(b, at, count, format) {
  const entries = [], names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 4 > b.length) fail('truncated directory');
    const length = b.readUInt32LE(at); at += 4;
    if (!length || length > 4096 || at + length + 32 + (format === 2 ? 4 : 0) > b.length) fail('invalid directory entry length');
    const pathBytes = b.subarray(at, at + length); at += length;
    const nul = pathBytes.indexOf(0), raw = nul < 0 ? pathBytes : pathBytes.subarray(0, nul);
    if (nul >= 0 && pathBytes.subarray(nul).some(x => x !== 0)) fail('directory path padding');
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { fail('malformed UTF-8 path'); }
    name = name.replace(/^res:\/\//, '');
    if (!name || /[\\\x00-\x1f\x7f:]/.test(name) || name.split('/').some(x => !x || x === '.' || x === '..') || names.has(name.toLowerCase())) fail('unsafe/duplicate path ' + JSON.stringify(name));
    names.add(name.toLowerCase());
    const offsetWord = at, offset = integer64(b, at), size = integer64(b, at + 8), md5sum = b.subarray(at + 16, at + 32).toString('hex');
    at += 32;
    let flags = 0;
    if (format === 2) { flags = b.readUInt32LE(at); at += 4; }
    entries.push({ name, offsetWord, offset, size, md5: md5sum, flags, encrypted: !!(flags & PACK_FILE_ENCRYPTED), removal: !!(flags & PACK_FILE_REMOVAL) });
  }
  return { entries, at };
}
function checkSpans(b, entries, base, dirEnd) {
  const spans = [];
  for (const e of entries) {
    if (e.removal) continue;
    const o = e.offset + base;
    if (o < dirEnd || o > b.length || e.size > b.length - o) return false;
    // Encrypted payload digests cover plaintext; they cannot be checked without the key (and are blockers).
    if (!e.encrypted && md5(b.subarray(o, o + e.size)) !== e.md5) return false;
    if (e.size) spans.push([o, o + e.size]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  return spans.every((x, i) => !i || spans[i - 1][1] <= x[0]);
}

/** Validate all directory bounds and content digests before returning normalized standalone bytes.
 * Only offset words (Godot 3) or the file-base word (Godot 4) can change; contents and stored MD5 never do.
 */
export function parsePack(input) {
  const loc = locatePack(input), b = input.subarray(loc.start, loc.end);
  if (b.length < 88) fail('truncated header');
  const format = b.readUInt32LE(4), triple = [8, 12, 16].map(o => b.readUInt32LE(o));
  const version = versionName(...triple), common = { ...loc, format, versionTriple: triple, version, sourceSha256: sha256(input) };
  if (format === 1) {
    if (triple[0] !== 3) fail('PCK format 1 with engine major ' + triple[0]);
    if (b.subarray(20, 84).some(x => x !== 0)) fail('nonzero reserved header: encrypted/custom pack unsupported');
    const count = b.readUInt32LE(84);
    if (!count || count > 100000) fail('invalid file count');
    const dir = readDirectory(b, 88, count, 1);
    // Godot 3 offsets are absolute in the containing file (embedded) or pack-relative; accept exactly one.
    const bases = [...new Set([-loc.start, 0])].filter(base => checkSpans(b, dir.entries, base, dir.at));
    if (bases.length !== 1) fail('directory bounds/overlap or per-file MD5 mismatch (or ambiguous offsets)');
    const pack = Buffer.from(b);
    for (const e of dir.entries) { e.offset += bases[0]; pack.writeBigUInt64LE(BigInt(e.offset), e.offsetWord); }
    return { ...common, flags: 0, encryptedDirectory: false, entries: dir.entries, pack, rebasedOffsets: bases[0] !== 0, packSha256: sha256(pack) };
  }
  if (format === 2) {
    if (triple[0] !== 4) fail('PCK format 2 with engine major ' + triple[0]);
    if (b.length < 100) fail('truncated header');
    const flags = b.readUInt32LE(20), fileBase = integer64(b, 24);
    if (flags & ~(PACK_DIR_ENCRYPTED | PACK_REL_FILEBASE)) fail('unknown pack flags 0x' + flags.toString(16));
    if (b.subarray(32, 96).some(x => x !== 0)) fail('nonzero reserved header: custom pack unsupported');
    const count = b.readUInt32LE(96);
    if (count > 100000) fail('invalid file count');
    if (flags & PACK_DIR_ENCRYPTED) // No key, no bypass: report it, never decrypt.
      return { ...common, flags, encryptedDirectory: true, entries: [], pack: null, rebasedOffsets: false, packSha256: null };
    const dir = readDirectory(b, 100, count, 2);
    const base = flags & PACK_REL_FILEBASE ? fileBase : fileBase - loc.start;
    if (base < 0 || !checkSpans(b, dir.entries, base, dir.at)) fail('directory bounds/overlap or per-file MD5 mismatch');
    const pack = Buffer.from(b);
    if (!(flags & PACK_REL_FILEBASE)) pack.writeBigUInt64LE(BigInt(base), 24);
    for (const e of dir.entries) e.offset += base;
    return { ...common, flags, encryptedDirectory: false, entries: dir.entries, pack, rebasedOffsets: !(flags & PACK_REL_FILEBASE) && base !== fileBase, packSha256: sha256(pack) };
  }
  fail('unsupported/encrypted PCK format ' + format + ' (supported: 1 = Godot 3, 2 = Godot 4.0-4.4)');
}

export const entryData = (parsed, name) => {
  const e = parsed.entries.find(x => x.name === name);
  return e && !e.encrypted ? parsed.pack.subarray(e.offset, e.offset + e.size) : null;
};

/** project.binary (ECFG): key -> value for bool/int/float/string/string-array; other variants as { type }. */
export function projectSettings(buf, major) {
  if (!buf || buf.length < 8 || buf.toString('latin1', 0, 4) !== 'ECFG') return null;
  const count = buf.readUInt32LE(4), out = {};
  const STRING_ARRAY = major === 3 ? 23 : 34;
  let at = 8;
  for (let i = 0; i < count && at + 8 <= buf.length; i++) {
    const kl = buf.readUInt32LE(at); at += 4;
    if (kl > 4096 || at + kl + 4 > buf.length) return out;
    const key = buf.toString('utf8', at, at + kl); at += kl;
    const vl = buf.readUInt32LE(at); at += 4;
    if (at + vl > buf.length) return out;
    const v = buf.subarray(at, at + vl); at += vl;
    if (v.length < 4) continue;
    const header = v.readUInt32LE(0), type = header & 0xff, wide = !!(header & (1 << 16));
    const str = (p) => { const n = v.readUInt32LE(p); return [v.toString('utf8', p + 4, p + 4 + n), p + 4 + ((n + 3) & ~3)]; };
    try {
      if (type === 1) out[key] = !!v.readUInt32LE(4);
      else if (type === 2) out[key] = wide ? Number(v.readBigInt64LE(4)) : v.readInt32LE(4);
      else if (type === 3) out[key] = wide ? v.readDoubleLE(4) : v.readFloatLE(4);
      else if (type === 4) out[key] = str(4)[0];
      else if (type === STRING_ARRAY) {
        const n = v.readUInt32LE(4), list = []; let p = 8;
        for (let k = 0; k < n && k < 1000; k++) { const [s, q] = str(p); list.push(s); p = q; }
        out[key] = list;
      } else out[key] = { type };
    } catch { out[key] = { type, malformed: true }; }
  }
  return out;
}

const TEXT = /\.(gd|tscn|tres|godot|gdnlib|gdns|gdextension|cfg|import|remap)$/i;
// export_presets.cfg is editor metadata (older 3.x exports ship it); the running game never reads it.
const EDITOR_ONLY = /(^|\/)export_presets\.cfg$/i;
/** Lower-cased paths only Mono/.NET builds ship: the C# glue/runtime assemblies, the Godot 3 Mono data layout,
 * assemblies in a data_<name>[_<platform>_<arch>] folder, the .mono/ build directory and C# sources/projects. */
const MONO_PATHS = [
  /(^|\/)(godotsharp|godotplugins|godottools[^/]*|mono-2\.0-sgen|monoposixhelper)\.dll$/,
  /(^|\/)data_[^/]+\/(assemblies|mono)\//,
  /(^|\/)data_[^/]+\/(.+\/)?[^/]+\.dll$/,
  /(^|\/)(\.mono|godotsharp|mono_gd[^/]*)\//,
  /\.(cs|csproj|sln)$/,
];
/** DLLs official Godot 4 Windows exports place beside the runner (Direct3D 12 Agility SDK, DXIL, ANGLE): not GDExtensions. */
const OFFICIAL_COMPANIONS = /(^|\/)(d3d12core|d3d12sdklayers|dxil|libegl|libglesv2)\.dll$/;
/** Bounded text scan of every text resource, covering chunk boundaries. Supplementary heuristics only. */
function scanText(parsed, patterns) {
  const hits = new Set();
  for (const e of parsed.entries) {
    if (e.encrypted || e.removal || !TEXT.test(e.name) || EDITOR_ONLY.test(e.name)) continue;
    const data = parsed.pack.subarray(e.offset, e.offset + e.size), chunk = 1048576, overlap = 512;
    for (let at = 0; at < data.length; at += chunk) {
      const text = data.subarray(Math.max(0, at - overlap), Math.min(data.length, at + chunk)).toString('utf8');
      for (const [id, re] of patterns) if (re.test(text)) hits.add(id);
    }
  }
  return hits;
}

/**
 * Static web-port analysis. blockers: no official web runtime can run this unchanged (or policy forbids it).
 * requirements.threads: 'required' when the game itself creates threads (select a threaded web runtime;
 * it needs COOP/COEP). Warnings never block; browser boot + input evidence remain mandatory.
 */
export function analyzePack(parsed, inventory = [], runnerInfo = null) {
  const major = parsed.versionTriple[0], blockers = new Set(), warnings = [], requirements = { threads: 'not-detected', renderer: 'webgl2' };
  if (parsed.encryptedDirectory) blockers.add('encrypted-pack');
  if (parsed.entries.some(e => e.encrypted)) blockers.add('encrypted-content');
  if (parsed.entries.some(e => e.removal)) blockers.add('patch-pack');
  if (inventory.some(f => f.format === 'pe-dotnet')) blockers.add('Mono/C#');
  if (parsed.entries.some(e => /\.pck$/i.test(e.name))) blockers.add('additional-packs');
  const names = [...parsed.entries.map(e => e.name), ...inventory.map(f => f.path)].map(n => n.toLowerCase());
  for (const name of names) {
    // Mono-specific paths only: a plain "mono/" folder (e.g. mono audio) is not C# evidence. Their assemblies are Mono, not GDNative.
    if (MONO_PATHS.some(re => re.test(name))) blockers.add('Mono/C#');
    else if (/\.(dll|so|dylib|gdnlib|gdns|gdextension)$/.test(name) && !(major === 4 && OFFICIAL_COMPANIONS.test(name)) || /(^|\/)\.godot\/extension_list\.cfg$/.test(name)) blockers.add(major === 3 ? 'native-extension/GDNative' : 'native-extension/GDExtension');
    if (/\.(gde|pcke|enc)$/.test(name)) blockers.add('encrypted-content');
  }
  for (const e of parsed.entries) {
    if (e.encrypted || e.removal) continue;
    if (parsed.pack.subarray(e.offset, e.offset + 4).toString('latin1') === 'GDEC') blockers.add('encrypted-script');
  }
  const settings = projectSettings(entryData(parsed, 'project.binary'), major);
  if (!settings) warnings.push('project-settings-unreadable: no plain project.binary');
  else {
    const features = Array.isArray(settings['application/config/features']) ? settings['application/config/features'] : [];
    if (features.includes('C#') || settings['dotnet/project/assembly_name'] || settings['mono/project/assembly_name']) blockers.add('Mono/C#');
    if (Array.isArray(settings['gdnative/singletons']) && settings['gdnative/singletons'].length) blockers.add('native-extension/GDNative');
    const method = settings['rendering/renderer/rendering_method.web'] ?? settings['rendering/renderer/rendering_method'];
    if (major === 4 && method && method !== 'gl_compatibility') warnings.push(`renderer: project uses ${method}; the web runtime renders with gl_compatibility (WebGL 2), visuals may differ`);
    const driver = settings['rendering/quality/driver/driver_name'];
    if (major === 3 && driver === 'GLES2') { requirements.renderer = 'webgl'; warnings.push('renderer: GLES2 project (WebGL 1 context)'); }
    if (major === 3 && settings['rendering/threads/thread_model'] === 2) warnings.push('project selects the multi-threaded renderer model (ignored by web runtimes)');
  }
  const hits = scanText(parsed, [
    ['threads', /\bThread\s*\.\s*new\s*\(|\bThread\s*\(\s*\)|extends\s+Thread\b/],
    ['worker-pool', /\bWorkerThreadPool\b/],
    ['os-execute', /\bOS\s*\.\s*(execute|create_process|create_instance|shell_open|kill)\s*\(/],
    ['additional-packs', /\.pck["']|load_resource_pack\s*\(/i],
    ['gdextension', /\bGDExtensionManager\b|\bNativeScript\b|\bGDNative\b/],
    // A scene/resource that loads a C# script (Godot exports the .cs resource path even when the file list hides it).
    ['csharp-script', /\bpath\s*=\s*"res:\/\/[^"\n]+\.cs"/],
  ]);
  if (hits.has('threads')) requirements.threads = 'required';
  if (hits.has('worker-pool')) warnings.push('WorkerThreadPool used: runs on the main thread in non-threaded web runtimes');
  if (hits.has('os-execute')) blockers.add('platform-code/OS.execute');
  if (hits.has('additional-packs')) blockers.add('additional-packs');
  if (hits.has('gdextension')) blockers.add(major === 3 ? 'native-extension/GDNative' : 'native-extension/GDExtension');
  if (hits.has('csharp-script')) blockers.add('Mono/C#');
  if (runnerInfo?.mono) blockers.add('Mono/C#');
  warnings.unshift('feature-scan-incomplete: static detection is not a complete platform feature inventory; require browser boot, input and no runtime errors before any level claim');
  if (parsed.entries.some(e => /\.gdc$/i.test(e.name))) warnings.push('compiled-GDScript: bytecode feature use is not scanned; structural native/Mono/encryption/thread detectors still apply');
  return { blockers: [...blockers].sort(), warnings, requirements, settings: settings ? pickSettings(settings) : null };
}
const pickSettings = s => Object.fromEntries(Object.entries(s).filter(([k, v]) => /^(application\/config\/(name|features)|application\/run\/main_scene|display\/window\/size\/(width|height|viewport_width|viewport_height)|rendering\/(renderer\/rendering_method(\.web)?|quality\/driver\/driver_name))$/.test(k) && typeof v !== 'object' || Array.isArray(v) && k.endsWith('features')));

/** Backward-compatible K45 interfaces. */
export function unsupportedFeatures(parsed, inventory = []) {
  const a = analyzePack(parsed, inventory);
  return [...new Set([...a.blockers, ...(a.requirements.threads === 'required' ? ['threads-required'] : [])])].sort();
}
export function featureWarnings(parsed) { return analyzePack(parsed).warnings; }

const VERSION_RE = /(?<![\d.])([34])\.(\d{1,2})(?:\.(\d{1,2}))?\.(stable|rc\d*|beta\d*|alpha\d*|dev\d*)(\.mono)?\.([a-z][a-z0-9_]{1,31})(?![\w])/g;
/**
 * Runner identity from version-string signatures: Godot builds embed "<x.y[.z]>.<status>[.mono].<build>" and
 * the 40-hex release commit. Signatures corroborate identity; they can be forged and do not prove a binary is
 * unmodified. With a runtime given, check that exact version/build.
 */
export function identifyRunner(runner, runtime, { knownBuilds = [] } = {}) {
  const text = runner.toString('latin1'), found = new Map();
  for (const m of text.matchAll(VERSION_RE)) {
    const key = m[0]; found.set(key, { version: versionName(Number(m[1]), Number(m[2]), Number(m[3] ?? 0)), status: m[4], mono: !!m[5], flavor: m[6], count: (found.get(key)?.count ?? 0) + 1 });
  }
  const sigs = [...found.values()].sort((a, b) => b.count - a.count);
  const primary = sigs.find(s => s.flavor === 'official') ?? sigs[0] ?? null;
  const blockers = [];
  const hashes = new Set(text.match(/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/g) ?? []);
  const builds = [...new Set([...(runtime ? [runtime.build] : []), ...knownBuilds])].filter(b => hashes.has(b));
  if (runtime) {
    const v = runtime.version;
    if (!sigs.some(s => s.version === v && s.status === 'stable' && s.flavor === 'official') || !hashes.has(runtime.build)) blockers.push('runner-exact-version/build-unverified');
  } else if (!primary) blockers.push('runner-version-unknown');
  else {
    if (primary.status !== 'stable') blockers.push('runner-prerelease-build');
    if (primary.flavor !== 'official') blockers.push('runner-custom-build');
    if (!builds.length) blockers.push('runner-exact-version/build-unverified');
  }
  // Mono only from a ".mono." signature: "GodotSharp" (and similar) symbol strings are in every official build,
  // including the non-Mono web runtimes. Companion assemblies/folders are checked by analyzePack on the inventory.
  const mono = sigs.some(s => s.mono);
  if (mono) blockers.push('Mono/C#-runner');
  return { engine: 'godot', version: runtime?.version ?? primary?.version ?? null, status: primary?.status ?? null, flavor: primary?.flavor ?? null,
    build: runtime ? (hashes.has(runtime.build) ? runtime.build : null) : builds[0] ?? null, mono, signatures: sigs.slice(0, 8), blockers,
    evidence: { versionSignature: runtime ? sigs.some(s => s.version === runtime.version && s.flavor === 'official') : !!primary, buildSignature: builds.length > 0 },
    note: 'Signatures can be forged; custom forks/modules still need review.' };
}
