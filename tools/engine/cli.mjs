#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inventory } from '../inspect/inspect.mjs';
import { buildEngine, detectProfile, publicDetection } from './framework.mjs';
import { detectEngines } from './detect.mjs';
import { fetchRuntime, isProvisioned, manifest, provision, runtimes, selectRuntime, storeRoot, verifyRuntime } from './runtime.mjs';
import { serveEngine } from './server.mjs';

const USAGE = `usage: npm run engine -- <command>
  detect [INPUT_ROOT [RUNNER [PACK]]]   detect known engines (default original/); with RUNNER: detailed profile detection
  runtimes [--version V]                list pinned official web runtimes, verification level and local cache status
  select VERSION [--threads]            exact-version runtime choice for a Godot version
  fetch ID [--full] [--allow-unpublished] [--from FILE.tpz|FILE.zip] [--keep-archive]
                                        download/import + verify an official runtime into $BGT_ENGINE_CACHE (${storeRoot()})
  doctor [ID]                           re-verify a cached runtime
  pin ID                                (kit maintainer) pin member/file SHA-256 from a published-SHA-512-verified install
  extract INPUT_ROOT RUNNER PACK NEW_OUT  write the normalized standalone pack
  build GAME_DIR | serve BUILD_DIR      engine bundle build / local server with the bundle's headers
  provision ID ZIP [NOTICES_DIR]        offline: pinned web template ZIP + notices`;
const flag = (args, name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (args, name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'provision') console.log(await provision(args[0], args[1], args[2] ? { notices: args[2] } : {}));
  else if (command === 'fetch') {
    const full = flag(args, '--full'), allowUnpublished = flag(args, '--allow-unpublished'), keepArchive = flag(args, '--keep-archive'), from = option(args, '--from');
    if (!args[0]) throw new Error('fetch requires a runtime id (see npm run engine -- runtimes)');
    const r = await fetchRuntime(args[0], { full, allowUnpublished, keepArchive, from, log: m => process.stderr.write(m + '\n') });
    console.log(`verified ${r.runtime.id} (${r.verification}) at ${r.target}`);
  } else if (command === 'doctor') {
    const p = verifyRuntime(args[0] ?? 'godot-3.5.3-nothreads');
    console.log(`verified ${p.runtime.id} ${p.receipt.archiveSha256} (${p.verification})`);
  } else if (command === 'runtimes') {
    const version = option(args, '--version');
    for (const r of runtimes().filter(r => !version || r.version === version)) {
      const level = r.member.sha256 ? 'pinned-member-sha256' : r.archive.sha512 ? 'published-archive-sha512 (full download)' : 'UNVERIFIED (needs --allow-unpublished)';
      let cached; try { cached = isProvisioned(r.id) ? 'cached' : '-'; } catch (e) { cached = 'CORRUPT: ' + e.message; }
      console.log(`${r.id.padEnd(24)} ${r.build.slice(0, 9)} threads=${r.requirements.threads ? 'yes (COOP/COEP)' : 'no '} ${level.padEnd(42)} ${cached}`);
    }
  } else if (command === 'select') {
    const s = selectRuntime({ version: args[0], threads: flag(args, '--threads') || undefined });
    console.log(JSON.stringify({ runtime: s.runtime?.id ?? null, candidates: s.candidates, blockers: s.blockers }, null, 2));
  } else if (command === 'pin') {
    const p = verifyRuntime(args[0]);
    if (p.verification !== 'published-archive-sha512') throw new Error('pin requires an install verified against the published archive SHA-512 (fetch --full)');
    const entry = manifest.runtimes.find(r => r.id === p.runtime.id), files = p.runtimeFiles.sort();
    Object.assign(entry.member, { sha256: p.receipt.archiveSha256, pinnedFrom: `full archive verified against the published SHA-512 (${new Date().toISOString().slice(0, 10)})` });
    entry.files = files; entry.fileHashes = Object.fromEntries(files.map(n => [n, p.files[n]]));
    writeFileSync(new URL('runtimes.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`pinned ${entry.id}: member ${entry.member.sha256}, ${files.length} files`);
  } else if (command === 'build') {
    const dir = resolve(args[0] ?? 'port');
    buildEngine(dir, JSON.parse(readFileSync(join(dir, 'game.json'))));
  } else if (command === 'serve') {
    const serving = await serveEngine(args[0]);
    if (serving.unverifiedRuntime) console.error('engine: WARNING serving an UNVERIFIED runtime (no published checksum; recorded opt-in)');
    console.log(serving.url);
  } else if (command === 'detect' && args.length <= 1) {
    const root = resolve(args[0] ?? 'original');
    console.log(JSON.stringify(detectEngines(inventory(root), root), null, 2));
  } else if (command === 'detect' || command === 'extract') {
    const [rootArg, runner, pack = runner, out] = args, root = resolve(rootArg);
    const detection = detectProfile(inventory(root), { root, runner, pack });
    console.log(JSON.stringify(publicDetection(detection), null, 2));
    if (command === 'extract') {
      if (!out) throw new Error('extract requires root runner pack NEW_OUTPUT_DIRECTORY');
      if (detection.blockers.length) throw new Error('unsupported: ' + detection.blockers.join(', '));
      if (existsSync(out)) throw new Error('extraction output already exists');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'game.pck'), detection._parsed.pack, { flag: 'wx' });
      writeFileSync(join(out, 'extract.json'), JSON.stringify(publicDetection(detection), null, 2) + '\n', { flag: 'wx' });
    }
  } else { console.error(USAGE); if (command && command !== 'help') process.exitCode = 1; }
} catch (e) { console.error('engine: ' + e.message); process.exitCode = 1; }
