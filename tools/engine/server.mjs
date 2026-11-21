import { createServer } from 'node:http';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { hash } from './runtime.mjs';
import { validatePort } from '../probe/server.mjs';
import { headersFor, staticHeaders } from './headers.mjs';

export async function serveEngine(dir, { port = Number(process.env.BGT_E2E_PORT ?? 5189) } = {}) {
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
  files.set('/manifest.json', Buffer.from(JSON.stringify(manifest)));
  // The bundle's own deploy headers (integrity-checked above) are what we serve; older builds derive them.
  const declared = files.has('/headers.json') ? JSON.parse(files.get('/headers.json')) : staticHeaders({ isolation: !!manifest.engineProfile?.requirements?.isolation });
  if (manifest.engineProfile?.requirements?.isolation && !declared.crossOriginIsolation) throw new Error('threaded engine build without cross-origin isolation headers');
  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400, declared.global); res.end(); return; }
    if (path === '/') path = '/index.html';
    const data = files.get(path);
    if (!['GET', 'HEAD'].includes(req.method) || !data) { res.writeHead(404, { ...declared.global, 'Cache-Control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { ...headersFor(declared, path), 'Cache-Control': 'no-store', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: 'http://127.0.0.1:' + port + '/', headers: declared, close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
