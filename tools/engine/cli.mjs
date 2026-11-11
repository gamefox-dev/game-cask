#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inventory } from '../inspect/inspect.mjs';
import { buildEngine, detectProfile, publicDetection } from './framework.mjs';
import { provision, verifyRuntime } from './runtime.mjs';
import { serveEngine } from './server.mjs';

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'provision') console.log(provision(args[0], args[1], args[2] ? { notices: args[2] } : {}));
  else if (command === 'doctor') { const p = verifyRuntime(args[0] ?? 'godot-3.5.3'); console.log('verified ' + p.runtime.id + ' ' + p.runtime.sha256); }
  else if (command === 'build') {
    const dir = resolve(args[0] ?? 'port');
    buildEngine(dir, JSON.parse(readFileSync(join(dir, 'game.json'))));
  } else if (command === 'serve') {
    const serving = await serveEngine(args[0]); console.log(serving.url);
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
  } else throw new Error('usage: engine {provision ID ZIP [NOTICES_DIR]|doctor [ID]|build GAME_DIR|serve BUILD_DIR|detect INPUT_ROOT RUNNER [PACK]|extract INPUT_ROOT RUNNER PACK NEW_OUT}');
} catch (e) { console.error('engine: ' + e.message); process.exitCode = 1; }
