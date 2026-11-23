// K68 Q12: delivery sizes of engine bundles (raw, gzip -9, brotli quality 11 / lgwin 24) and optional precompressed
// siblings. Brotli q11 is slow (about 20 s for the 13.8 MB Godot 3.5.3 wasm), so sizes are cached by content SHA-256
// and codec parameters in a private cache (.engine-private/compress-cache): the official runtime files are identical
// across builds and variants, and so is a game's pack.
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync, constants as zc } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const COMPRESSION = Object.freeze({ gzip: { level: 9 }, brotli: { quality: 11, lgwin: 24 } });
const sha256 = b => createHash('sha256').update(b).digest('hex');
const codecVersion = () => `zlib-${process.versions.zlib}-brotli-${process.versions.brotli}`;

export const gzipBytes = data => gzipSync(data, { level: COMPRESSION.gzip.level });
export const brotliBytes = data => brotliCompressSync(data, { params: { [zc.BROTLI_PARAM_QUALITY]: COMPRESSION.brotli.quality,
  [zc.BROTLI_PARAM_LGWIN]: COMPRESSION.brotli.lgwin, [zc.BROTLI_PARAM_SIZE_HINT]: data.length } });

/**
 * { bytes, gzipBytes, brotliBytes } of one file. cacheDir (optional) keeps the compressed sizes by SHA-256 + codec
 * parameters + zlib/brotli library versions; a cache entry for other bytes can never be used (the key is the hash).
 */
const cacheFile = (cacheDir, hash) => cacheDir ? join(cacheDir, `${hash}-gz${COMPRESSION.gzip.level}-br${COMPRESSION.brotli.quality}w${COMPRESSION.brotli.lgwin}.json`) : null;
function remember(cacheDir, file, sizes) {
  if (!file) return;
  mkdirSync(cacheDir, { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...sizes, codec: codecVersion() }) + '\n'); renameSync(tmp, file);
}
export function compressedSizes(data, { cacheDir = null, hash = sha256(data) } = {}) {
  const file = cacheFile(cacheDir, hash);
  if (file && existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'));
      if (c.bytes === data.length && c.codec === codecVersion() && Number.isSafeInteger(c.gzipBytes) && Number.isSafeInteger(c.brotliBytes))
        return { bytes: data.length, gzipBytes: c.gzipBytes, brotliBytes: c.brotliBytes };
    } catch { /* recompute a corrupt entry */ }
  }
  const sizes = { bytes: data.length, gzipBytes: gzipBytes(data).length, brotliBytes: brotliBytes(data).length };
  remember(cacheDir, file, sizes);
  return sizes;
}
/** Sizes plus the compressed bytes themselves (precompressed siblings); refreshes the size cache. */
export function compressedOutputs(data, { cacheDir = null, hash = sha256(data) } = {}) {
  // The compressed bytes are cached too; a cached file is reused only if it DECOMPRESSES to exactly these bytes.
  const file = cacheFile(cacheDir, hash), reuse = name => {
    try {
      const bytes = readFileSync(join(cacheDir, `${hash}.${name}`));
      const decoded = name === 'br' ? brotliDecompressSync(bytes) : gunzipSync(bytes);
      return decoded.length === data.length && sha256(decoded) === hash && hash === sha256(data) ? bytes : null;
    } catch { return null; }
  };
  const br = (file && reuse('br')) || brotliBytes(data), gz = (file && reuse('gz')) || gzipBytes(data);
  const sizes = { bytes: data.length, gzipBytes: gz.length, brotliBytes: br.length };
  if (file) {
    mkdirSync(cacheDir, { recursive: true });
    for (const [name, bytes] of [['br', br], ['gz', gz]]) { const tmp = join(cacheDir, `${hash}.${name}.${process.pid}.tmp`); writeFileSync(tmp, bytes); renameSync(tmp, join(cacheDir, `${hash}.${name}`)); }
    const tmp = file + '.' + process.pid + '.tmp';
    writeFileSync(tmp, JSON.stringify({ ...sizes, codec: codecVersion() }) + '\n'); renameSync(tmp, file);
  }
  return { sizes, br, gz };
}

/**
 * Bundle totals from per-file sizes. download* = every file the page may fetch (runtime JS/wasm/worklets/workers,
 * pack, adapter, shell); bundleBytes = everything served (also notices and header files); manifest.json is the +1.
 */
export function bundleMetrics(sizes, { runtimeFiles, wasm, boot, served }) {
  for (const name of served) if (!sizes[name]) throw new Error('bundleMetrics: no sizes for ' + name);
  const sum = (names, k) => names.reduce((n, x) => n + sizes[x][k], 0);
  // vK68: a file travels encoded only when it gets a precompressed sibling (precompressible, >= 1 KiB, >= 5% smaller);
  // otherwise it is served as is, so the download totals count its raw bytes. Per-file gzipBytes/brotliBytes stay the
  // codec output.
  const delivered = (names, k) => names.reduce((n, x) => n + (precompressible(x) && keepCompressed(sizes[x].bytes, sizes[x][k]) ? sizes[x][k] : sizes[x].bytes), 0);
  return { schema: 'game-cask/engine-bundle-metrics/2', packBytes: sizes['game.pck'].bytes, runtimeBytes: sum(runtimeFiles, 'bytes'),
    wasmBytes: sizes[wasm].bytes, downloadBytes: sum(boot, 'bytes'), downloadGzipBytes: delivered(boot, 'gzipBytes'), downloadBrotliBytes: delivered(boot, 'brotliBytes'),
    bundleBytes: sum(served, 'bytes'), fileCount: served.length + 1, compression: COMPRESSION, files: sizes,
    note: 'downloadBytes: every file the page may fetch (runtime JS/wasm/worklets/workers, pack, shell); download gzip/brotli: what is sent with Content-Encoding (gzip -9, brotli q11/lgwin 24, each file on its own) for files that get a precompressed sibling (>= 1 KiB, >= 5% smaller), raw bytes for the others' };
}

/** Which files get precompressed siblings: compressible payloads of at least 1 KiB that shrink by at least 5%. */
export const PRECOMPRESS_MIN_BYTES = 1024, PRECOMPRESS_MAX_RATIO = 0.95;
export const precompressible = name => /\.(js|wasm|pck|html|txt)$/.test(name);
export const keepCompressed = (raw, compressed) => raw >= PRECOMPRESS_MIN_BYTES && compressed <= raw * PRECOMPRESS_MAX_RATIO;
