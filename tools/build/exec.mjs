// Finite regular-file stdin: Node's synchronous pipe transport can stall before EOF.
// The detached supervisor preserves writer leases and bounds the entire helper tree.
import { execFileSync as nativeExec } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ROOT } from './toolchain.mjs';
let token = null;
export const buildWriterToken = () => token;
export function withBuildWriters(lease, fn) {
  const previous=token;token=lease;
  try {return fn();} finally {token=previous;}
}
export function execFileSync(command, args, options = {}) {
  const { input, phase = basename(args.find((a) => a.endsWith('.py')) ?? command), ...rest } = options;
  const timeout = Number(options.timeout ?? process.env.BGT_BUILD_TIMEOUT_MS ?? 30 * 60 * 1000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147481647)
    throw new Error('BGT_BUILD_TIMEOUT_MS/timeout must be a positive integer <= 2147481647');
  let dir, fd;
  try {
    let stdio = rest.stdio;
    if (input !== undefined) {
      dir = mkdtempSync(join(tmpdir(), 'bgt-input-'));
      const path = join(dir, 'input');
      writeFileSync(path, input, { mode: 0o600, encoding: rest.encoding === 'buffer' ? 'utf8' : rest.encoding });
      fd = openSync(path, 'r');
      // Anonymous after open: crashes cannot leave private build configurations behind.
      rmSync(dir, { recursive: true }); dir = undefined;
      stdio = Array.isArray(stdio) ? [...stdio] : [stdio ?? 'pipe', stdio ?? 'pipe', stdio ?? 'pipe'];
      stdio[0] = fd;
    }
    return nativeExec('python3', ['-I', join(ROOT, 'tools/build/writer.py'), token ?? '-',
      String(timeout), phase, command, ...args], {
      ...rest, stdio, detached: true, timeout: timeout + 2000, killSignal: 'SIGKILL',
    });
  } catch (error) {
    // Also covers supervisor startup failure, maxBuffer and the outer hard deadline.
    // Node kills only the direct child; all descendants in our detached group must die.
    if (error.pid) {
      try { process.kill(-error.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    error.message = `build helper failed: phase=${phase}, timeout=${timeout}ms, argv=${JSON.stringify([command, ...args])}: ${error.message}`;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
