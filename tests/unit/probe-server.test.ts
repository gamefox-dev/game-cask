// Probe ownership: an arbitrary HTTP 200 must never become permission to navigate.
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { ROOT } from '../support/headless';
// @ts-expect-error -- plain ESM module
import { startServer, stopServer, validatePort, verifyServer } from '../../tools/probe/server.mjs';

const exec = promisify(execFile);
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('missing listener');
  return { port: addr.port, url: `http://127.0.0.1:${addr.port}/` };
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

it.each(['html', 'json'])('occupied explicit port (%s 200) fails CLI before any HTTP request or navigation', async (kind) => {
  const requests: string[] = [];
  const occupying = createServer((req, res) => {
    requests.push(req.url!);
    if (kind === 'json' && req.url === '/games/index.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ games: [{ id: 'win32-hello', name: 'synthetic occupant' }] }));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>window.__BGT_TEST__ = { ready: () => true, failed: () => false,
        diagnostics: () => ({backend:'webgl2',backendNotes:[],errors:[]}) };</script>`);
    }
  });
  const dir = mkdtempSync(join(tmpdir(), 'bgt-probe-owner-'));
  try {
    const { port } = await listen(occupying);
    writeFileSync(join(dir, 'script.mjs'), `export default async p => p.log('UNRELATED PAGE EXECUTED');`);
    const result = await exec(process.execPath, [join(ROOT, 'tools/probe/probe.mjs'), '--game', 'win32-hello',
      '--script', join(dir, 'script.mjs'), '--port', String(port), '--out', join(dir, 'out')],
    { cwd: ROOT, timeout: 20000 }).then(() => ({ code: 0 }), (e) => ({ code: e.code }));
    expect(result.code).toBe(1);
    const log = JSON.parse(readFileSync(join(dir, 'out/probe.json'), 'utf8'));
    expect(log.errors.join('\n')).toMatch(/server exited before readiness.*|Port .* is already in use/s);
    expect(log.lines).toEqual([]);
    expect(requests).toEqual([]); // Stronger than just no root navigation: no readiness requests either.
    // The occupying server still belongs to this test, and the probe did not kill it.
    expect(occupying.listening).toBe(true);
  } finally {
    await close(occupying);
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(['wrong-owner', 'html-index', 'invalid-json', 'bad-index', 'missing-game', 'redirect'])('readiness rejects %s before navigation', async (kind) => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/__bgt_probe_owner__/')) {
      res.end(JSON.stringify({ nonce: kind === 'wrong-owner' ? 'some-other-child' : 'expected' }));
    } else if (kind === 'redirect') {
      res.writeHead(302, { Location: '/other' }); res.end();
    } else if (kind === 'html-index') {
      res.setHeader('Content-Type', 'text/html'); res.end('<html>another SPA</html>');
    } else if (kind === 'invalid-json') res.end('not JSON');
    else if (kind === 'bad-index') res.end(JSON.stringify({ games: [null] }));
    else res.end(JSON.stringify({ games: [{ id: 'another-game', name: 'other' }] }));
  });
  try {
    const { url } = await listen(server);
    await expect(verifyServer(url, 'expected', 'win32-hello')).rejects.toThrow();
  } finally { await close(server); }
});

it('failed manifest readiness cleans up the child and permits a subsequent owned listener', async () => {
  const reservation = createServer();
  const { port } = await listen(reservation);
  await close(reservation);
  await expect(startServer(port, 'not-a-built-game')).rejects.toThrow('probe game not built');
  const server = await startServer(port, 'win32-hello');
  await stopServer(server.child);
  expect(server.child.exitCode !== null || server.child.signalCode !== null).toBe(true);
});

it.each([0, -1, 65536, 12.5, NaN, 5173])('rejects invalid/developer port %s before spawning', (port) => {
  expect(() => validatePort(port)).toThrow();
});
