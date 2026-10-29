// Shared toolchain discovery. Zig is used purely as a hermetic clang +
// wasm-ld distribution (`zig cc --target=wasm32-freestanding`).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PINNED_ZIG = readFileSync(join(ROOT, '.zig-version'), 'utf8').trim();

export function findZig() {
  const candidates = [process.env.ZIG, 'zig', '/opt/homebrew/bin/zig', '/usr/local/bin/zig'].filter(Boolean);
  for (const c of candidates) {
    try {
      const version = execFileSync(c, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return { path: c, version };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function requireZig({ quiet = false } = {}) {
  const zig = findZig();
  if (!zig) {
    console.error(
      [
        'error: zig not found (needed as the C -> wasm32 compiler).',
        `  install zig ${PINNED_ZIG}:`,
        '    macOS:  brew install zig        (or download from https://ziglang.org/download/)',
        '    Linux:  https://ziglang.org/download/  then put `zig` on PATH',
        '  or set ZIG=/path/to/zig',
      ].join('\n'),
    );
    process.exit(2);
  }
  if (zig.version !== PINNED_ZIG && !quiet) {
    console.warn(`warning: zig ${zig.version} found, kit is pinned to ${PINNED_ZIG} (.zig-version). Builds may differ.`);
  }
  return zig;
}

export function playwrightBrowsersInstalled() {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'install', '--dry-run', 'chromium'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = [...out.matchAll(/Install location:\s+(.+)/g)].map((x) => x[1].trim());
    return m.length > 0 && m.every((p) => existsSync(p));
  } catch {
    return false;
  }
}
