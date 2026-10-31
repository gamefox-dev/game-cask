#!/usr/bin/env node
// Opt-in real-model supervisor acceptance: two tiny independent lanes, thinking low.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { clearTimeout } from 'node:timers';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.BGT_SUPERVISOR_E2E_DIR ?? 'node_modules/.cache/supervisor-e2e');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'run-'));
const source = join(dir, 'source'), seed = join(dir, 'seed');
mkdirSync(source); mkdirSync(seed);
const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'base');
writeFileSync(join(source, 'README.md'), 'Original tiny supervisor fixture. No game files or dependencies.\n');
git('add', '.'); git('-c', 'user.name=Harness fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
const original = process.env.PI_LANES_AGENT_SEED ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
for (const name of ['auth.json', 'models.json']) {
  if (existsSync(join(original, name))) copyFileSync(join(original, name), join(seed, name));
}
const config = join(original, 'pi-cliproxyapi-provider/config.json');
const globalConfig = join(homedir(), '.pi/agent/pi-cliproxyapi-provider/config.json');
if (existsSync(config) || existsSync(globalConfig)) {
  mkdirSync(join(seed, 'pi-cliproxyapi-provider'));
  copyFileSync(existsSync(config) ? config : globalConfig, join(seed, 'pi-cliproxyapi-provider/config.json'));
}
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(done => reservation.close(done));
const queue = join(dir, 'queue');
writeFileSync(queue, ['tinyA', 'tinyB'].map((lane, i) => {
  const brief = join(dir, `${lane}.md`);
  writeFileSync(brief, `Tiny harness integration fixture. Use the write tool exactly once to write lane.txt in the current ` +
    `directory with the exact text "${lane}_OK\\n" (a trailing newline). Do not read files or run shell commands. ` +
    `Then answer exactly ${lane}_DONE. No questions.\n`);
  return `${lane}|${dir}/${lane}|${dir}/scratch-${lane}|${5501 + i}|${brief}`;
}).join('\n'));
let model = process.env.PI_MODEL ?? 'cpa/gpt-6.1-sol';
if (!model.includes('/')) model = `${process.env.PI_PROVIDER ?? 'cpa'}/${model}`;
const run = join(dir, 'supervisor');
const child = spawn('bash', [join(here, 'supervise.sh'), source, 'HEAD', run, queue], {
  env: { ...process.env, PI_MODEL: model, PI_THINKING: 'low', PI_TIMEOUT: '240', PI_MAX_ATTEMPTS: '2',
    PI_RETRY_BACKOFF: '2', PI_LANES_MAX: '2', PI_LANES_AGENT_SEED: seed, PI_BRIDGE_PORT: String(port),
    PI_LANES_MIN_FREE_KB: '1048576', PI_EXTRA_ARGS: '--no-skills --no-prompt-templates --no-context-files --no-approve',
    // Already inside the operator's sandbox; never attempt an unsandboxed fallback from seatbelt.
    PI_LANES_SANDBOX: process.env.PI_LANES_SANDBOX ?? '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
const timer = setTimeout(() => child.kill('SIGTERM'), 300000);
try {
  const [code] = await once(child, 'close');
  assert.equal(code, 0, log + ` artifacts=${dir}`);
  for (const lane of ['tinyA', 'tinyB']) {
    assert.equal(readFileSync(join(dir, lane, 'lane.txt'), 'utf8'), `${lane}_OK\n`);
    assert.match(readFileSync(join(dir, `scratch-${lane}/result.txt`), 'utf8'), new RegExp(`${lane}_DONE`));
    assert.equal(JSON.parse(readFileSync(join(run, `results/${lane}.json`))).exit, 0);
    console.log(`PASS ${lane}: real pi wrote exact marker, final answer, exit=0`);
  }
  const state = JSON.parse(readFileSync(join(run, 'bridge/bridge-state.json')));
  assert.equal(state.supervisor.code, 0);
  for (const lane of ['tinyA', 'tinyB']) assert.equal(state.lanes[lane].driverExit, 0);
  console.log(`PASS supervisor exit and both driver exit events; model=${model} thinking=low artifacts=${dir}`);
} finally {
  clearTimeout(timer);
  if (existsSync(join(run, 'bridge.pid'))) {
    try { process.kill(Number(readFileSync(join(run, 'bridge.pid'), 'utf8')), 'SIGTERM'); } catch { /* already stopped */ }
  }
}
