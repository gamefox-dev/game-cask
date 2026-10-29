#!/usr/bin/env node
// `npm run doctor`: verify the pinned toolchain and explain how to fix gaps.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, PINNED_ZIG, findZig, playwrightBrowsersInstalled } from './toolchain.mjs';

let ok = true;
const line = (status, what, fix = '') => {
  if (status === 'FAIL') ok = false;
  const showFix = fix && status !== 'OK' && status !== 'INFO';
  console.log(`${status.padEnd(4)}  ${what}${showFix ? `\n      fix: ${fix}` : ''}`);
};

const nodeWant = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
const major = Number(process.versions.node.split('.')[0]);
line(major >= 20 ? 'OK' : 'FAIL', `node ${process.versions.node} (pinned ${nodeWant}, need >= 20)`, 'nvm install && nvm use');
line(existsSync(join(ROOT, 'node_modules', 'vite')) ? 'OK' : 'FAIL', 'npm dependencies installed', 'npm ci');

const zig = findZig();
if (!zig) line('FAIL', 'zig (C -> wasm32 compiler) not found', `brew install zig, or download ${PINNED_ZIG} from https://ziglang.org/download/ (or set ZIG=/path/to/zig)`);
else line(zig.version === PINNED_ZIG ? 'OK' : 'WARN', `zig ${zig.version} at ${zig.path} (pinned ${PINNED_ZIG})`, zig.version === PINNED_ZIG ? '' : 'builds may differ; install the pinned version for reproducible wasm');

line(playwrightBrowsersInstalled() ? 'OK' : 'FAIL', 'Playwright Chromium installed', 'npx playwright install chromium   (Linux CI: npx playwright install --with-deps chromium)');

const orig = join(ROOT, 'original');
const files = existsSync(orig) ? (await import('node:fs')).readdirSync(orig).filter((f) => f !== '.gitkeep') : [];
line('INFO', files.length ? `original/ contains ${files.length} entr${files.length === 1 ? 'y' : 'ies'}` : 'original/ is empty (copy your game there to port it)');
console.log(ok ? '\ndoctor: ready' : '\ndoctor: fix the FAIL items above');
process.exit(ok ? 0 : 1);
