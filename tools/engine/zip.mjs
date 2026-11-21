// Minimal, strict ZIP reader for official engine template archives (outer .tpz and inner web template .zip).
// Sources are random-access: a local file, an in-memory buffer or an HTTPS URL read with Range requests, so a
// single web template can be taken from a 1 GB release archive without downloading the rest. Every entry is
// validated (paths, types, encryption, sizes) before any is used; every extracted member is CRC32/size checked.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { crc32, inflateRawSync } from 'node:zlib';

const MAX_MEMBER = 512 * 1024 ** 2;

export function fileSource(path) {
  const fd = openSync(path, 'r'), size = fstatSync(fd).size;
  return { size, describe: path, close: () => closeSync(fd), read: async (offset, length) => {
    const out = Buffer.alloc(length); let at = 0;
    while (at < length) { const n = readSync(fd, out, at, length - at, offset + at); if (!n) throw new Error('zip: short read ' + path); at += n; }
    return out;
  } };
}
/** HTTPS-only Range source. fetchImpl is injectable for tests. */
export async function httpSource(url, { fetchImpl = globalThis.fetch, expectedSize } = {}) {
  if (!/^https:\/\//.test(url)) throw new Error('zip: only https sources are allowed');
  const head = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
  const range = head.headers.get('content-range');
  await head.arrayBuffer().catch(() => {});
  if (head.status !== 206 || !range || !/^bytes 0-0\/\d+$/.test(range)) throw new Error('zip: server does not support byte ranges for ' + url);
  const size = Number(range.split('/')[1]);
  if (expectedSize !== undefined && size !== expectedSize) throw new Error(`zip: remote size ${size} != pinned ${expectedSize}`);
  return { size, describe: url, read: async (offset, length) => {
    if (!length) return Buffer.alloc(0);
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetchImpl(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, redirect: 'follow' });
        const body = Buffer.from(await r.arrayBuffer());
        if (r.status !== 206 || r.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${size}` || body.length !== length) throw new Error(`zip: bad range response ${r.status} for ${offset}+${length}`);
        return body;
      } catch (e) { if (attempt >= 4) throw e; await new Promise(res => setTimeout(res, 1000 * attempt)); }
    }
  } };
}

function eocd(tail, tailStart) {
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) return { at: tailStart + i, b: tail.subarray(i) };
  throw new Error('zip: end of central directory not found');
}
// Parsing is a generator that yields [offset, length] reads, so one implementation serves async (HTTP/file)
// and sync (in-memory) sources.
const drive = (gen, read) => { let r = gen.next(); while (!r.done) r = gen.next(read(...r.value)); return r.value; };
async function driveAsync(gen, read) { let r = gen.next(); while (!r.done) r = gen.next(await read(...r.value)); return r.value; }
export const listEntries = source => driveAsync(listGen(source.size), source.read);
export const listEntriesSync = buf => drive(listGen(buf.length), (o, n) => buf.subarray(o, o + n));
export const readEntrySync = (buf, entry) => drive(readGen(entry), (o, n) => buf.subarray(o, o + n));
function* listGen(sourceSize) {
  const source = { size: sourceSize };
  const tailLength = Math.min(source.size, 65557 + 20), tailStart = source.size - tailLength;
  const tail = yield [tailStart, tailLength], e = eocd(tail, tailStart);
  let count = e.b.readUInt16LE(10), cdSize = e.b.readUInt32LE(12), cdOffset = e.b.readUInt32LE(16);
  if (e.b.readUInt16LE(4) !== 0 || e.b.readUInt16LE(6) !== 0) throw new Error('zip: multi-disk archives unsupported');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = e.at - 20 - tailStart;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip: zip64 locator missing');
    const z = yield [Number(tail.readBigUInt64LE(loc + 8)), 56];
    if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('zip: zip64 EOCD missing');
    count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48));
  }
  if (count > 100000 || cdOffset + cdSize > source.size) throw new Error('zip: implausible central directory');
  const cd = yield [cdOffset, cdSize], entries = [];
  for (let at = 0, i = 0; i < count; i++) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) throw new Error('zip: corrupt central directory');
    const nameLength = cd.readUInt16LE(at + 28), extraLength = cd.readUInt16LE(at + 30), commentLength = cd.readUInt16LE(at + 32);
    const raw = cd.subarray(at + 46, at + 46 + nameLength), extra = cd.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    let compressedSize = cd.readUInt32LE(at + 20), size = cd.readUInt32LE(at + 24), offset = cd.readUInt32LE(at + 42);
    for (let x = 0; x + 4 <= extra.length;) {
      const id = extra.readUInt16LE(x), n = extra.readUInt16LE(x + 2); let y = x + 4;
      if (id === 1) {
        if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(y)); y += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(extra.readBigUInt64LE(y)); y += 8; }
        if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(y)); }
      }
      x += 4 + n;
    }
    entries.push({ name: raw.toString((cd.readUInt16LE(at + 8) & 0x800) ? 'utf8' : 'latin1'), flags: cd.readUInt16LE(at + 8),
      method: cd.readUInt16LE(at + 10), crc32: cd.readUInt32LE(at + 16), compressedSize, size, offset,
      createSystem: cd.readUInt8(at + 5), externalAttr: cd.readUInt32LE(at + 38) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reject unsafe paths, links/special files, encrypted members and duplicates (every entry, before any use). */
export function validateEntries(entries, { maxTotal = 4 * 1024 ** 3, maxFile = MAX_MEMBER } = {}) {
  const seen = new Set(); let total = 0;
  for (const e of entries) {
    const dir = e.name.endsWith('/'), path = dir ? e.name.slice(0, -1) : e.name;
    if (!path || e.name.startsWith('/') || e.name.includes('\\') || e.name.includes(':') || /[\x00-\x1f\x7f]/.test(e.name) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('zip: unsafe path ' + JSON.stringify(e.name));
    const mode = e.createSystem === 3 ? e.externalAttr >>> 16 : 0, kind = mode & 0o170000;
    if (![0, 0o100000, 0o040000].includes(kind) || (e.flags & 1)) throw new Error('zip: non-plain/encrypted member ' + e.name);
    if ((kind === 0o040000 && !dir) || (kind === 0o100000 && dir)) throw new Error('zip: inconsistent member type ' + e.name);
    if (![0, 8].includes(e.method) && !dir) throw new Error('zip: unsupported compression method ' + e.method + ' for ' + e.name);
    if (seen.has(e.name)) throw new Error('zip: duplicate member ' + e.name);
    seen.add(e.name);
    if (dir) continue;
    total += e.size;
    if (e.size > maxFile || total > maxTotal) throw new Error('zip: archive member too large ' + e.name);
  }
  return entries;
}

export const readEntry = (source, entry) => driveAsync(readGen(entry), source.read);
function* readGen(entry) {
  const local = yield [entry.offset, 30];
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('zip: bad local header for ' + entry.name);
  const dataAt = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const raw = yield [dataAt, entry.compressedSize];
  if (raw.length !== entry.compressedSize) throw new Error('zip: truncated member ' + entry.name);
  const data = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: entry.size + 1 });
  if (data.length !== entry.size || crc32(data) !== entry.crc32) throw new Error('zip: CRC32/size mismatch for ' + entry.name);
  return data;
}

/** Validated member map of an in-memory archive, keyed by base name; nested dirs are flattened, collisions refused. */
export function extractFlatSync(buf, { names, maxTotal = 512 * 1024 ** 2 } = {}) {
  const entries = validateEntries(listEntriesSync(buf), { maxTotal, maxFile: 256 * 1024 ** 2 });
  const files = new Map();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const base = e.name.split('/').pop();
    if (files.has(base)) throw new Error('zip: duplicate runtime member ' + base);
    files.set(base, e);
  }
  for (const n of names ?? []) if (!files.has(n)) throw new Error('zip: missing runtime member ' + n);
  const out = new Map();
  for (const [base, e] of files) if (!names || names.includes(base)) out.set(base, readEntrySync(buf, e));
  return out;
}
export async function extractFlat(buf, options) { return extractFlatSync(buf, options); }
