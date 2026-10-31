/* global AbortSignal */
// A probe never reuses an existing endpoint. IPC is sent only after this child binds;
// HTTP identity then proves that requests reach that same listener, not another SPA.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { clearTimeout } from 'node:timers';
import { ROOT } from '../build/toolchain.mjs';

export function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('probe port must be an integer in 1..65535');
  if (port === 5173) throw new Error('port 5173 is the developer\'s dev server; pick another');
}

export async function stopServer(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

export async function verifyServer(url, nonce, game) {
  const get = async (path) => {
    const r = await fetch(new URL(path, url), { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(`invalid probe readiness response: ${path} (${r.status})`);
    return r.json();
  };
  const identity = await get(`__bgt_probe_owner__/${nonce}`);
  if (identity.nonce !== nonce) throw new Error('probe server ownership mismatch');
  const index = await get('games/index.json');
  if (!Array.isArray(index.games) || !index.games.every((g) => typeof g?.id === 'string' && typeof g?.name === 'string')) throw new Error('invalid probe games index');
  if (!index.games.some((g) => g.id === game)) throw new Error(`probe game not built: ${game}`);
}

export async function startServer(port, game) {
  validatePort(port);
  const nonce = randomUUID();
  const child = spawn(process.execPath, [join(ROOT, 'tools/probe/server-child.mjs'), String(port), nonce], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  const record = (data) => { output = (output + data).slice(-16384); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const url = `http://127.0.0.1:${port}/`;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.off('message', message);
        child.off('error', error);
        child.off('exit', exit);
      };
      const error = (e) => { cleanup(); reject(e); };
      const exit = () => error(new Error(`probe server exited before readiness: ${output}`));
      const message = (m) => {
        if (m?.type !== 'listening' || m.pid !== child.pid || m.nonce !== nonce || m.url !== url) {
          error(new Error('invalid probe child readiness identity'));
        } else { cleanup(); resolve(); }
      };
      const timer = setTimeout(() => error(new Error(`probe server did not start on ${port}: ${output}`)), 30000);
      child.on('message', message);
      child.once('error', error);
      child.once('exit', exit);
    });
    await verifyServer(url, nonce, game);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('probe server exited during readiness');
    return { child, url };
  } catch (e) {
    await stopServer(child);
    throw e;
  }
}
