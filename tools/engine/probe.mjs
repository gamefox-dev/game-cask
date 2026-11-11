#!/usr/bin/env node
// Same scripted probe facade, official engine runtime instead of the BGT host.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { makeProbe } from '../probe/probe.mjs';
import { serveEngine } from './server.mjs';
import { captureEngineErrors } from './capture.mjs';
import { runtimeById } from './runtime.mjs';
const [buildArg, scriptArg, outArg = 'reports/engine-probe'] = process.argv.slice(2);
let server, browser;
const log = { schema: 'game-cask/engine-probe/1', path: 'engineProfile', lines: [], console: [], errors: [], artifacts: [], notes: [] };
const out = resolve(outArg); mkdirSync(out, { recursive: true });
try {
  if (!buildArg || !scriptArg) throw new Error('usage: npm run engine:probe -- BUILD_DIR SCRIPT.mjs [OUT_DIR]');
  const build = JSON.parse(readFileSync(join(buildArg, 'manifest.json')));
  log.engineProfile = build.engineProfile;
  server = await serveEngine(buildArg); browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: server.url, viewport: { width: 960, height: 540 } });
  page.on('console', m => log.console.push(m.type() + ': ' + m.text()));
  const capture = await captureEngineErrors(page, runtimeById(build.engineProfile.runtime.id).fileHashes);
  const p = makeProbe(page, { game: build.id, backend: build.engineProfile.requirements.renderer, out, params: {}, log, engineUrl: server.url });
  await p.start(); const script = await import(pathToFileURL(resolve(scriptArg)).href); await script.default(p);
  log.network = await capture.finish(); log.errors.push(...log.network.errors);
  log.diagnostics = await p.diagnostics(); log.errors.push(...log.diagnostics.errors.map(e => e.kind + ': ' + e.message));
  if (log.errors.length) process.exitCode = 1;
} catch (e) { log.errors.push(e.message); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); writeFileSync(join(out, 'probe.json'), JSON.stringify(log, null, 2) + '\n'); }
