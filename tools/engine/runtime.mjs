// Official engine web runtimes: manifest lookup, exact-version selection, download/verification and local cache.
// Runtimes are cached OUTSIDE the repository ($BGT_ENGINE_CACHE, default ~/.cache/game-cask/engine-runtimes) and
// never committed. Trust comes only from tools/engine/runtimes.json (checked in, generated from the official
// release host by tools/engine/godot-releases.mjs):
//   pinned-member-sha256      the web template ZIP's SHA-256 is pinned (derived from a full archive verified
//                             against the release's published SHA-512, or reviewer-supplied); range fetch is enough
//   published-archive-sha512  the whole export-template archive is downloaded and checked against the published SHA-512
//   manifest-crc32            no published checksum exists for that release: only the pinned central-directory
//                             CRC32/size and TLS from the official host. Weak; needs --allow-unpublished, recorded.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { extractFlatSync, fileSource, httpSource, listEntries, readEntry, validateEntries } from './zip.mjs';

export const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PRIVATE = join(ENGINE_ROOT, '.engine-private');
export const storeRoot = () => resolve(process.env.BGT_ENGINE_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'game-cask', 'engine-runtimes'));
export const STORE = storeRoot();
export const hash = b => createHash('sha256').update(b).digest('hex');
export const manifest = JSON.parse(readFileSync(new URL('runtimes.json', import.meta.url)));
const TEMPLATE = 'web-template.zip';
/** Levels a cache receipt may claim for this manifest entry: a receipt can never raise what the manifest allows. */
export function allowedVerifications(r) {
  if (r.member?.sha256) return ['pinned-member-sha256', ...(r.archive?.sha512 ? ['published-archive-sha512'] : [])];
  return r.archive?.sha512 ? ['published-archive-sha512'] : ['manifest-crc32'];
}
/** Only manifest-crc32 is unverified (no published checksum; explicit --allow-unpublished / allowUnverifiedRuntime). */
export const isVerified = level => level !== 'manifest-crc32';

/** Flattened view used by builds/tests: sha256 = web template ZIP SHA-256 when pinned (null otherwise). */
function view(r) {
  return { ...r, sha256: r.member?.sha256 ?? null, files: r.files ?? null, fileHashes: r.fileHashes ?? null, pinned: !!(r.member?.sha256 && r.fileHashes) };
}
export function runtimes() { return manifest.runtimes.map(view); }
export function runtimeById(id) {
  const r = manifest.runtimes.find(r => r.id === id || r.aliases?.includes(id));
  if (!r) throw new Error('runtime not allowlisted: ' + id);
  if (!r.notices?.length || r.notices.some(n => !/^[a-f0-9]{64}$/.test(n.sha256))) throw new Error('runtime requires hash-pinned notices');
  return view(r);
}
/** Godot reports x.y.0 as "x.y" (runtime ids, tags and runner strings); pack headers carry three numbers. */
export const godotVersion = triple => { const [a, b, c = 0] = String(triple).split('.').map(Number); return c ? `${a}.${b}.${c}` : `${a}.${b}`; };
/** Exact-version runtime choice. threads: true|false|undefined (undefined: prefer the non-threaded build). */
export function selectRuntime({ engine = 'godot', version, threads }) {
  const exact = manifest.runtimes.filter(r => r.engine === engine && r.version === godotVersion(version)).map(view);
  const blockers = [];
  if (!exact.length) return { runtime: null, candidates: [], blockers: ['no-official-web-runtime-for-version'] };
  let pick = threads === true ? exact.find(r => r.requirements.threads) : threads === false ? exact.find(r => !r.requirements.threads) : exact.find(r => !r.requirements.threads) ?? exact.find(r => r.requirements.threads);
  if (!pick) { blockers.push(threads ? 'threads-required-but-no-threaded-web-runtime' : 'no-non-threaded-web-runtime'); pick = null; }
  return { runtime: pick, candidates: exact.map(r => r.id), blockers };
}

const receiptPath = target => join(target, 'provision.json');
function install(runtime, memberZip, { store = storeRoot(), notices, verification, archive }) {
  if (runtime.member?.sha256 && hash(memberZip) !== runtime.member.sha256) throw new Error('runtime archive SHA-256 mismatch');
  return (async () => {
    const files = extractFlatSync(memberZip, { names: runtime.files ?? undefined });
    const fileHashes = Object.fromEntries([...files].map(([n, b]) => [n, hash(b)]));
    if (runtime.fileHashes) for (const [n, h] of Object.entries(runtime.fileHashes)) if (fileHashes[n] !== h) throw new Error('runtime member hash mismatch: ' + n);
    if (!files.has(runtime.entry) || ![...files.keys()].some(n => n.endsWith('.wasm'))) throw new Error('runtime archive lacks ' + runtime.entry + '/wasm');
    const root = resolve(store), target = join(root, runtime.id);
    mkdirSync(root, { recursive: true });
    const staging = mkdtempSync(join(root, '.provision-'));
    try {
      const out = join(staging, runtime.id); mkdirSync(out);
      for (const [n, b] of files) writeFileSync(join(out, n), b, { flag: 'wx' });
      // Keep the official web template ZIP: verification of unpinned runtimes re-extracts it, never trusts the receipt.
      writeFileSync(join(out, TEMPLATE), memberZip, { flag: 'wx' });
      runtime.notices.forEach(n => writeFileSync(join(out, n.file), notices.get(n.file), { flag: 'wx' }));
      const all = { ...fileHashes, ...Object.fromEntries(runtime.notices.map(n => [n.file, n.sha256])) };
      writeFileSync(receiptPath(out), JSON.stringify({ schema: 'game-cask/engine-provision/2', runtime: runtime.id, archiveSha256: hash(memberZip),
        verification, archive: archive ?? null, files: all, installed: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
      if (existsSync(target)) rmSync(target, { recursive: true }); // replace only once the new copy is complete
      renameSync(out, target);
    } finally { rmSync(staging, { recursive: true, force: true }); }
    return target;
  })();
}
function checkedNotices(runtime, read) {
  const m = new Map();
  for (const n of runtime.notices) { const b = read(n); if (hash(b) !== n.sha256) throw new Error('notice SHA-256 mismatch: ' + n.file); m.set(n.file, b); }
  return m;
}
/** Offline: a local web template ZIP (e.g. templates/webassembly_release.zip) whose SHA-256 is pinned, plus notices. */
export function provision(id, archive, { store = storeRoot(), notices = resolve(archive, '..') } = {}) {
  const runtime = runtimeById(id), zip = readFileSync(archive);
  if (!runtime.member?.sha256) throw new Error('offline ZIP provisioning needs a pinned member SHA-256; use engine fetch --from <templates.tpz> for ' + runtime.id);
  if (hash(zip) !== runtime.sha256) throw new Error('runtime archive SHA-256 mismatch');
  const n = checkedNotices(runtime, x => readFileSync(join(notices, x.file)));
  const target = join(resolve(store), runtime.id);
  if (existsSync(target)) { verifyRuntime(id, { store }); return target; }
  return install(runtime, zip, { store, notices: n, verification: 'pinned-member-sha256', archive: { localFile: true } });
}

async function download(url, size, file, { fetchImpl = globalThis.fetch, parallel = 8, chunk = 8 * 1024 ** 2, log = () => {} } = {}) {
  const source = await httpSource(url, { fetchImpl, expectedSize: size }), fd = openSync(file, 'w');
  try {
    let next = 0, done = 0;
    const worker = async () => {
      for (;;) {
        const at = next; if (at >= size) return; next += chunk;
        const b = await source.read(at, Math.min(chunk, size - at)); writeSync(fd, b, 0, b.length, at);
        const before = Math.floor(done / (64 * 1048576)); done += b.length;
        if (Math.floor(done / (64 * 1048576)) !== before || done === size) log(`  ${(done / 1048576).toFixed(0)}/${(size / 1048576).toFixed(0)} MiB`);
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally { closeSync(fd); }
}
function sha512File(file) {
  const h = createHash('sha512'), fd = openSync(file, 'r'), b = Buffer.alloc(16 * 1024 ** 2);
  try { for (let at = 0, n; (n = readSync(fd, b, 0, b.length, at)) > 0; at += n) h.update(b.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest('hex');
}

/**
 * Download (or import with from=FILE) and install an exact runtime. Options:
 *   full: download the whole release archive and check its published SHA-512 even if the member is pinned
 *   allowUnpublished: accept manifest-crc32 verification for releases without published checksums
 *   from: local .tpz (export templates) or web template .zip
 */
export async function fetchRuntime(id, { store = storeRoot(), full = false, allowUnpublished = false, from, fetchImpl = globalThis.fetch, log = () => {}, keepArchive = false, runtime: entry } = {}) {
  // `runtime` lets tests supply a synthetic manifest entry; it is verified exactly like a checked-in one.
  const runtime = entry ? view(entry) : runtimeById(id), a = runtime.archive, m = runtime.member;
  const notices = async () => {
    const out = new Map();
    for (const n of runtime.notices) {
      const r = await fetchImpl(n.url); if (!r.ok) throw new Error('notice download failed: ' + n.url);
      out.set(n.file, Buffer.from(await r.arrayBuffer()));
    }
    return checkedNotices(runtime, n => out.get(n.file));
  };
  const fromArchive = async (file, verification) => {
    const src = fileSource(file);
    try {
      const entries = validateEntries(await listEntries(src)), e = entries.find(x => x.name === m.name);
      if (!e) throw new Error('release archive lacks ' + m.name);
      if (e.crc32 !== m.crc32 || e.size !== m.size) throw new Error('web template CRC32/size differs from the manifest pin');
      return { zip: await readEntry(src, e), verification };
    } finally { src.close(); }
  };
  let got;
  if (from) {
    const probe = fileSource(from), isTpz = (await listEntries(probe)).some(e => e.name === m.name); probe.close();
    if (isTpz) {
      const digest = a.sha512 ? sha512File(from) : null;
      if (a.sha512 && digest !== a.sha512) throw new Error('release archive SHA-512 differs from the published checksum');
      if (!a.sha512 && !m.sha256 && !allowUnpublished) throw new Error(runtime.id + ': release publishes no checksum; pass --allow-unpublished to accept CRC32-only verification');
      got = await fromArchive(from, a.sha512 ? 'published-archive-sha512' : m.sha256 ? 'pinned-member-sha256' : 'manifest-crc32');
    } else {
      const zip = readFileSync(from);
      if (!m.sha256) throw new Error('a bare web template ZIP needs a pinned member SHA-256 (' + runtime.id + ' has none); import the .tpz instead');
      got = { zip, verification: 'pinned-member-sha256' };
    }
  } else if (m.sha256 && !full) {
    const src = await httpSource(a.url, { fetchImpl, expectedSize: a.size });
    const e = validateEntries(await listEntries(src)).find(x => x.name === m.name);
    if (!e || e.crc32 !== m.crc32 || e.size !== m.size) throw new Error('remote web template differs from the manifest pin');
    log('range-fetching ' + m.name + ' (' + e.compressedSize + ' bytes) from ' + a.url);
    got = { zip: await readEntry(src, e), verification: 'pinned-member-sha256' };
  } else if (a.sha512) {
    const dir = join(resolve(store), '.downloads'); mkdirSync(dir, { recursive: true });
    const file = join(dir, a.url.split('/').pop());
    log('downloading full release archive (' + (a.size / 1048576).toFixed(0) + ' MiB) to verify the published SHA-512: ' + a.url);
    if (!existsSync(file) || lstatSync(file).size !== a.size) { await download(a.url, a.size, file + '.partial', { fetchImpl, log }); renameSync(file + '.partial', file); }
    if (sha512File(file) !== a.sha512) { rmSync(file); throw new Error('release archive SHA-512 differs from the published checksum'); }
    try { got = await fromArchive(file, 'published-archive-sha512'); } finally { if (!keepArchive) rmSync(file, { force: true }); }
  } else {
    if (!allowUnpublished) throw new Error(runtime.id + ': release publishes no checksum; pass --allow-unpublished to accept CRC32-only verification (recorded as manifest-crc32)');
    const src = await httpSource(a.url, { fetchImpl, expectedSize: a.size });
    const e = validateEntries(await listEntries(src)).find(x => x.name === m.name);
    if (!e || e.crc32 !== m.crc32 || e.size !== m.size) throw new Error('remote web template differs from the manifest pin');
    got = { zip: await readEntry(src, e), verification: 'manifest-crc32' };
  }
  const local = from && runtime.notices.every(n => existsSync(join(resolve(from, '..'), n.file)));
  const target = await install(runtime, got.zip, { store, notices: local ? checkedNotices(runtime, n => readFileSync(join(resolve(from, '..'), n.file))) : await notices(),
    verification: got.verification, archive: { url: a.url, sha512: a.sha512 ?? null, member: m.name } });
  const r = verifyRuntime(id, { store, runtime: entry });
  log(`installed ${runtime.id} -> ${target} (${got.verification}); member SHA-256 ${r.receipt.archiveSha256}`);
  return r;
}

export function verifyRuntime(id, { store = storeRoot(), runtime: entry } = {}) {
  const runtime = entry ? view(entry) : runtimeById(id), target = join(resolve(store), runtime.id);
  if (!existsSync(target)) throw new Error('runtime not provisioned: ' + runtime.id + ' (use npm run engine -- fetch ' + runtime.id + ')');
  if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) throw new Error('invalid/symlink runtime directory');
  if (!existsSync(receiptPath(target)) || lstatSync(receiptPath(target)).isSymbolicLink()) throw new Error('corrupted provisioned runtime: missing/invalid receipt');
  const receipt = JSON.parse(readFileSync(receiptPath(target)));
  if (receipt.runtime !== runtime.id || (runtime.sha256 && receipt.archiveSha256 !== runtime.sha256)) throw new Error('runtime provision receipt mismatch');
  const verification = receipt.verification ?? 'pinned-member-sha256';
  if (!allowedVerifications(runtime).includes(verification)) throw new Error(`runtime receipt claims verification ${verification}, impossible for ${runtime.id} (allowed: ${allowedVerifications(runtime).join(', ')})`);
  let expected;
  if (runtime.fileHashes) {
    // Pinned runtimes re-verify against the checked-in manifest, never merely the mutable receipt.
    expected = { ...runtime.fileHashes, ...Object.fromEntries(runtime.notices.map(n => [n.file, n.sha256])) };
  } else {
    // Unpinned: recompute from the cached official ZIP, which must match the manifest's CRC32/size pin.
    const zipFile = join(target, TEMPLATE);
    if (!existsSync(zipFile) || lstatSync(zipFile).isSymbolicLink()) throw new Error('provisioned runtime lacks its web template ZIP (re-fetch ' + runtime.id + ')');
    const zip = readFileSync(zipFile);
    if (zip.length !== runtime.member.size || crc32(zip) !== runtime.member.crc32 || hash(zip) !== receipt.archiveSha256) throw new Error('provisioned runtime web template differs from the manifest pin');
    expected = { ...Object.fromEntries([...extractFlatSync(zip)].map(([n, b]) => [n, hash(b)])), ...Object.fromEntries(runtime.notices.map(n => [n.file, n.sha256])) };
  }
  for (const n of runtime.notices) if (expected[n.file] !== n.sha256) throw new Error('provisioned runtime hash mismatch: ' + n.file);
  for (const [name, sha] of Object.entries(expected)) {
    const file = join(target, name);
    if (!existsSync(file)) throw new Error('provisioned runtime hash mismatch: ' + name);
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || hash(readFileSync(file)) !== sha || receipt.files[name] !== sha) throw new Error('provisioned runtime hash mismatch: ' + name);
  }
  const extra = readdirSync(target).filter(n => n !== 'provision.json' && n !== TEMPLATE && !(n in expected));
  if (extra.length) throw new Error('provisioned runtime has unexpected files: ' + extra.join(', '));
  return { runtime, target, receipt, verification, verified: isVerified(verification), files: expected, runtimeFiles: Object.keys(expected).filter(n => !runtime.notices.some(x => x.file === n)) };
}
export const isProvisioned = (id, opts) => { try { verifyRuntime(id, opts); return true; } catch (e) { if (/not provisioned/.test(e.message)) return false; throw e; } };
