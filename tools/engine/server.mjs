import { createServer } from 'node:http';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { hash } from './runtime.mjs';
import { validatePort } from '../probe/server.mjs';
import { headersFor, staticHeaders } from './headers.mjs';

/**
 * K68/vK68: which precompressed sibling to send for an Accept-Encoding header (RFC 9110 12.5.3). Each coding's
 * weight is its own q value, else the q of "*", else 0 (not acceptable); q=0 always refuses, also "br;q=0" next to
 * "*". The acceptable sibling with the highest q wins (br on a tie). null = send the identity bytes: also when the
 * client refuses identity (identity;q=0 / *;q=0) but accepts no sibling we have, since a static bundle has no other
 * representation (no 406).
 */
export function acceptedEncoding(header, available) {
  const weights = new Map();
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [token, ...params] = part.trim().split(';').map(x => x.trim());
    if (!token) continue;
    const q = params.find(x => /^q\s*=/.test(x)), value = q ? Number(q.split('=')[1]) : 1;
    weights.set(token, Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
  }
  const weight = coding => weights.has(coding) ? weights.get(coding) : weights.get('*') ?? 0;
  const candidates = [['br', 'br'], ['gz', 'gzip']].filter(([key]) => available[key]).map(([key, coding]) => ({ key, q: weight(coding) })).filter(c => c.q > 0);
  candidates.sort((a, b) => b.q - a.q);
  return candidates[0]?.key ?? null;
}

/**
 * Serves a verified engine build. K68: `precompressed: true` also serves the build's hash-checked .br/.gz siblings
 * (manifest.precompressed) to requests that accept them, with Content-Encoding, the original Content-Type
 * (application/wasm keeps streaming compilation) and Vary: Accept-Encoding. Off by default: tests and probes check
 * delivered bodies against the identity bytes.
 */
export async function serveEngine(dir, { port = Number(process.env.BGT_E2E_PORT ?? 5189), precompressed = false } = {}) {
  validatePort(port);
  const root = realpathSync(resolve(dir)), manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  if (!['game-cask/engine-build/1', 'game-cask/engine-build/2'].includes(manifest.schema) || manifest.path !== 'engineProfile') throw new Error('not an engine build');
  // Verify every served payload at startup; the handler only serves this byte snapshot.
  const files = new Map();
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') throw new Error('invalid engine manifest path');
    const file = join(root, name);
    if (lstatSync(file).isSymbolicLink() || !realpathSync(file).startsWith(root + sep)) throw new Error('symlink engine payload');
    const data = readFileSync(file);
    if (hash(data) !== expected) throw new Error('engine build integrity mismatch: ' + name);
    files.set('/' + name, data);
  }
  const encoded = new Map();
  if (precompressed) for (const [name, entries] of Object.entries(manifest.precompressed ?? {})) {
    if (!files.has('/' + name)) throw new Error('precompressed sibling of an unlisted file: ' + name);
    const variants = {};
    for (const [encoding, { sha256 }] of Object.entries(entries)) {
      if (!['br', 'gz'].includes(encoding)) throw new Error('unknown precompressed encoding ' + encoding);
      const file = join(root, `${name}.${encoding}`);
      if (lstatSync(file).isSymbolicLink() || !realpathSync(file).startsWith(root + sep)) throw new Error('symlink engine payload');
      const data = readFileSync(file);
      if (hash(data) !== sha256) throw new Error('engine build integrity mismatch: ' + name + '.' + encoding);
      variants[encoding] = data;
    }
    encoded.set('/' + name, variants);
  }
  files.set('/manifest.json', Buffer.from(JSON.stringify(manifest)));
  const runtime = manifest.engineProfile?.runtime;
  if (runtime?.verification === 'manifest-crc32' && manifest.engineProfile.allowUnverifiedRuntime !== true) throw new Error('engine build uses an UNVERIFIED runtime without the recorded allowUnverifiedRuntime opt-in');
  // The bundle's own deploy headers (integrity-checked above) are what we serve; older builds derive them.
  const declared = files.has('/headers.json') ? JSON.parse(files.get('/headers.json')) : staticHeaders({ isolation: !!manifest.engineProfile?.requirements?.isolation });
  if (manifest.engineProfile?.requirements?.isolation && !declared.crossOriginIsolation) throw new Error('threaded engine build without cross-origin isolation headers');
  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400, declared.global); res.end(); return; }
    if (path === '/') path = '/index.html';
    const data = files.get(path);
    if (!['GET', 'HEAD'].includes(req.method) || !data) { res.writeHead(404, { ...declared.global, 'Cache-Control': 'no-store' }); res.end(); return; }
    const siblings = encoded.get(path), encoding = siblings ? acceptedEncoding(req.headers['accept-encoding'], siblings) : null;
    const body = encoding ? siblings[encoding] : data;
    res.writeHead(200, { ...headersFor(declared, path), 'Cache-Control': 'no-store', 'Content-Length': body.length,
      ...(siblings ? { Vary: 'Accept-Encoding' } : {}), ...(encoding ? { 'Content-Encoding': encoding === 'br' ? 'br' : 'gzip' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: 'http://127.0.0.1:' + port + '/', headers: declared, precompressed: [...encoded.keys()].map(p => p.slice(1)), unverifiedRuntime: runtime?.verification === 'manifest-crc32', close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
