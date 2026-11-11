// Godot 3 pack adapter. Static only; no runner is ever executed.
import { createHash } from 'node:crypto';

export const sha256 = b => createHash('sha256').update(b).digest('hex');
const md5 = b => createHash('md5').update(b).digest('hex');
const MAGIC = Buffer.from('GDPC');
const MAX_INPUT = 2 * 1024 ** 3;
function fail(message) { throw new Error('godot3: ' + message); }
function integer64(b, at) {
  const n = b.readBigUInt64LE(at);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('unsafe 64-bit directory value');
  return Number(n);
}

/** Header at zero or trailer-derived ONLY: incidental GDPC strings are not packs. */
export function locatePack(input) {
  if (input.length > MAX_INPUT) fail('input exceeds 2 GiB adapter limit');
  if (input.subarray(0, 4).equals(MAGIC)) return { start: 0, end: input.length, location: 'standalone' };
  if (input.length < 12 || !input.subarray(-4).equals(MAGIC)) fail('no GDPC header or appended trailer');
  const end = input.length - 12, size = integer64(input, end), start = end - size;
  if (size < 88 || start < 0 || !input.subarray(start, start + 4).equals(MAGIC)) fail('invalid appended GDPC trailer bounds/header');
  return { start, end, location: 'embedded-trailer' };
}

/** Validate all directory bounds and content digests before returning normalized bytes.
 * Only offset words can change; file contents and their stored MD5 values never do.
 */
export function parsePack(input) {
  const loc = locatePack(input), b = input.subarray(loc.start, loc.end);
  if (b.length < 88) fail('truncated header');
  const format = b.readUInt32LE(4), version = [8, 12, 16].map(o => b.readUInt32LE(o)).join('.');
  if (format !== 1) fail('unsupported/encrypted PCK format (only Godot 3 format 1)');
  if (!version.startsWith('3.')) fail('unsupported engine major version ' + version);
  if (b.subarray(20, 84).some(x => x !== 0)) fail('nonzero reserved header: encrypted/custom pack unsupported');
  const candidates = [];
  for (const [countBytes, minimum] of [[4, 88]]) {
    if (b.length < minimum) continue;
    const countBig = countBytes === 4 ? BigInt(b.readUInt32LE(84)) : b.readBigUInt64LE(84);
    if (countBig > 100000n || countBig === 0n) continue;
    const count = Number(countBig), entries = [], names = new Set(); let at = minimum, okay = true;
    for (let i = 0; i < count && okay; i++) {
      if (at + 4 > b.length) { okay = false; break; }
      const length = b.readUInt32LE(at); at += 4;
      if (!length || length > 4096 || at + length + 32 > b.length) { okay = false; break; }
      const pathBytes = b.subarray(at, at + length); at += length;
      const nul = pathBytes.indexOf(0), raw = nul < 0 ? pathBytes : pathBytes.subarray(0, nul);
      if (nul >= 0 && pathBytes.subarray(nul).some(x => x !== 0)) { okay = false; break; }
      let name;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { okay = false; break; }
      name = name.replace(/^res:\/\//, '');
      if (!name || /[\\\\\x00-\x1f\x7f:]/.test(name) || name.split('/').some(x => !x || x === '.' || x === '..') || names.has(name.toLowerCase())) { okay = false; break; }
      names.add(name.toLowerCase());
      const offsetWord = at, offset = integer64(b, at), size = integer64(b, at + 8), md5sum = b.subarray(at + 16, at + 32).toString('hex');
      at += 32; entries.push({ name, offsetWord, offset, size, md5: md5sum });
    }
    if (okay) candidates.push({ entries, at });
  }
  let selected = null;
  for (const candidate of candidates) {
    const valid = base => {
      const spans = [];
      for (const e of candidate.entries) {
        const o = e.offset - base;
        if (o < candidate.at || o > b.length || e.size > b.length - o) return false;
        if (md5(b.subarray(o, o + e.size)) !== e.md5) return false;
        if (e.size) spans.push([o, o + e.size]);
      }
      spans.sort((x, y) => x[0] - y[0]);
      return spans.every((x, i) => !i || spans[i - 1][1] <= x[0]);
    };
    const bases = [...new Set([loc.start, 0])].filter(valid);
    if (bases.length === 1) { selected = { ...candidate, base: bases[0] }; break; }
  }
  if (!selected) fail('directory bounds/overlap or per-file MD5 mismatch (or ambiguous offsets)');
  const pack = Buffer.from(b);
  for (const e of selected.entries) { e.offset -= selected.base; pack.writeBigUInt64LE(BigInt(e.offset), e.offsetWord); }
  return { ...loc, format, version, entries: selected.entries, pack, rebasedOffsets: selected.base !== 0,
    sourceSha256: sha256(input), packSha256: sha256(pack) };
}

export function unsupportedFeatures(parsed, inventory = []) {
  const blockers = new Set();
  const names = [...parsed.entries.map(e => e.name), ...inventory.map(f => f.path)].map(n => n.toLowerCase());
  for (const name of names) {
    if (/\.(dll|so|dylib|gdnlib|gdns)$/.test(name)) blockers.add('native-extension/GDNative');
    if (/\.(cs|csproj|sln)$/.test(name) || /(^|\/)(mono|\.mono)(\/|$)/.test(name)) blockers.add('Mono/C#');
    if (/\.(gde|pcke|enc)$/.test(name)) blockers.add('encrypted-content');
    if (/\.worker\.js$/.test(name)) blockers.add('threads-build');
  }
  for (const e of parsed.entries) {
    const data = parsed.pack.subarray(e.offset, e.offset + Math.min(e.size, 1048576));
    if (data.subarray(0, 4).toString('ascii') === 'GDEC') blockers.add('encrypted-script');
    if (/\.(gd|tscn|tres|godot|gdnlib)$/.test(e.name)) {
      const text = data.toString('utf8');
      if (/\b(Thread\.new|Thread\s*\(|JavaScript\.eval|OS\.execute)/.test(text)) blockers.add('threads/platform-code');
      if (/\.pck["']|load_resource_pack\s*\(/i.test(text)) blockers.add('additional-packs');
    }
  }
  return [...blockers].sort();
}

/** runner signatures are corroboration, not proof that arbitrary forks are official. */
export function identifyRunner(runner, runtime) {
  const text = runner.toString('latin1'), blockers = [];
  if (!text.includes(runtime.version + '.stable.official') || !text.includes(runtime.build)) blockers.push('runner-exact-version/build-unverified');
  if (/stable\.mono|GodotSharp|mono_gd/gi.test(text)) blockers.push('Mono/C#-runner');
  if (/SharedArrayBuffer|\.worker\.js|PThread/.test(text)) blockers.push('threads-runner');
  return { engine: 'godot', version: runtime.version, build: runtime.build, blockers,
    evidence: { versionSignature: text.includes(runtime.version + '.stable.official'), buildSignature: text.includes(runtime.build) },
    note: 'Signatures can be forged; custom forks/modules still need operator review.' };
}
