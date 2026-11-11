import { createServer } from 'node:http';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { hash } from './runtime.mjs';
import { validatePort } from '../probe/server.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
export async function serveEngine(dir, { port = Number(process.env.BGT_E2E_PORT ?? 5189) } = {}) {
  validatePort(port);
  const root = realpathSync(resolve(dir)), manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  if (manifest.schema !== 'game-cask/engine-build/1' || manifest.path !== 'engineProfile') throw new Error('not an engine build');
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
  files.set('/manifest.json', Buffer.from(JSON.stringify(manifest)));
  const server = createServer((req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      // Restrict subresources/connects/embeds. CSP is not an OS sandbox or navigation policy.
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'",
      ...(manifest.engineProfile.requirements.isolation ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}) };
    let path;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400, headers); res.end(); return; }
    if (path === '/') path = '/index.html';
    const data = files.get(path);
    if (!['GET', 'HEAD'].includes(req.method) || !data) { res.writeHead(404, headers); res.end(); return; }
    res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: 'http://127.0.0.1:' + port + '/', close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
