#!/usr/bin/env node
// Opt-in, model-backed check. Only workspace -e loading; isolated agent/session state, no global installs.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startBridge } from './server.mjs';
import { request } from './client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.BGT_BRIDGE_E2E_DIR ?? 'node_modules/.cache/bridge-e2e');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'run-'));
const work = join(dir, 'work'), home = join(dir, 'home'), agent = join(home, '.pi/agent');
mkdirSync(work); mkdirSync(agent, { recursive: true });
const originalAgent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
// Copy ONLY provider definitions and auth. Never copy extensions, packages or settings that could install them.
for (const name of ['auth.json', 'models.json']) {
  const source = join(originalAgent, name);
  if (existsSync(source)) copyFileSync(source, join(agent, name));
}
// An explicitly loaded cpa provider reads its connection config via homedir(), not PI_CODING_AGENT_DIR.
const providerConfig = join(homedir(), '.pi/agent/pi-cliproxyapi-provider/config.json');
if (existsSync(providerConfig)) {
  mkdirSync(join(agent, 'pi-cliproxyapi-provider'));
  copyFileSync(providerConfig, join(agent, 'pi-cliproxyapi-provider/config.json'));
}
writeFileSync(join(agent, 'settings.json'), JSON.stringify({ cacheWarming: 'off', enableAnalytics: false,
  enableInstallTelemetry: false, compaction: { enabled: false }, retry: { enabled: false } }));
const { server, store } = startBridge({ dir: join(dir, 'bridge'), port: 0 });
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let model = process.env.PI_MODEL ?? 'cpa/gpt-6.1-sol';
if (!model.includes('/') && process.env.PI_PROVIDER) model = `${process.env.PI_PROVIDER}/${model}`;
const env = { ...process.env, HOME: home, PI_MODEL: model, PI_THINKING: 'low', PI_BRIDGE: '1', PI_LANE: 'fixture',
  PI_BRIDGE_PORT: String(server.address().port), PI_CODING_AGENT_DIR: agent, PI_TIMEOUT: '240',
  PI_EXTRA_ARGS: '--no-skills --no-prompt-templates --no-context-files --no-approve', PI_LEAN: '1' };
const prompt = join(dir, 'brief.md'), out = join(dir, 'result.txt');
writeFileSync(prompt, `This is a tiny bridge integration fixture, not kit work. Do not read files or make changes.
Remember the session fact: the flower token is ORCHID_742.
First call ask_reviewer with question "Which finish marker?", options ["REVIEWER_OK", "SAFE_DEFAULT"],
default "SAFE_DEFAULT", timeout_s 180. Use the tool, not a textual question. Wait for its answer.
Then briefly quote the exact answer you received and finish with DONE. Answer any live reviewer question briefly
in your next assistant text before finishing. Never ask another question.\n`);
const child = spawn('bash', [join(here, '../run-pi.sh'), work, prompt, out], {
  env, stdio: ['ignore', 'pipe', 'pipe'],
});
const completion = new Promise((accept, reject) => {
  child.on('error', reject);
  child.on('close', code => code === 0 ? accept(code) : reject(new Error(`pi driver exited ${code}`)));
});
// Mark handled immediately, even if a startup failure occurs while polling for the first status.
completion.catch(() => {});
let diagnostics = '';
child.stdout.on('data', b => { diagnostics = (diagnostics + b).slice(-4000); });
child.stderr.on('data', b => { diagnostics = (diagnostics + b).slice(-4000); });
async function until(predicate, label) {
  const deadline = Date.now() + 180000;
  while (!predicate()) {
    if (child.exitCode !== null) throw new Error(`${label}: pi exited ${child.exitCode}`);
    if (Date.now() >= deadline) throw new Error(`${label}: timeout`);
    await sleep(100);
  }
}
try {
  await until(() => store.state.lanes.fixture?.sessionFile, 'status');
  console.log('PASS status updates arrived');
  await until(() => store.state.questions.some(q => q.to === 'reviewer'), 'ask_reviewer');
  const decision = store.state.questions.find(q => q.to === 'reviewer');
  // Queue while the instance is blocked in a real tool. It must be delivered at the next turn boundary.
  const live = await request('/questions', { lane: 'fixture', to: 'instance',
    question: 'Reply with LIVE_OK now, then continue your task.' }, { base });
  // Exercise the real CLI fork path, with the same isolated credentials and the current published session.
  const beforeFork = readFileSync(store.state.lanes.fixture.sessionFile, 'utf8');
  const fork = spawn(process.execPath, [join(here, 'cli.mjs'), 'ask', '--lane', 'fixture', '--fork',
    'What is the flower token recorded in this session? Reply with that token only.'], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let forkOut = '', forkErr = '';
  fork.stdout.on('data', b => { forkOut += b; }); fork.stderr.on('data', b => { forkErr += b; });
  const [forkCode] = await once(fork, 'close');
  assert.equal(forkCode, 0, forkErr);
  assert.match(forkOut, /ORCHID_742/);
  assert.equal(readFileSync(store.state.lanes.fixture.sessionFile, 'utf8'), beforeFork);
  console.log('PASS fork question answered from no-tools session copy (original unchanged)');
  const waiter = spawn(process.execPath, [join(here, 'cli.mjs'), 'wait', '--for', 'finished',
    '--lanes', 'fixture', '--timeout-s', '180'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let waitOut = '';
  waiter.stdout.on('data', b => { waitOut += b; });
  const waiting = once(waiter, 'close');
  await request('/answers', { id: decision.id, text: 'REVIEWER_OK' }, { base });
  const [waitCode] = await waiting;
  await completion;
  assert.equal(waitCode, 0);
  assert.equal(waitOut, 'fixture finished exit=0\n');
  assert(store.state.lanes.fixture.steps >= 2);
  assert(store.state.lanes.fixture.context?.tokens > 0);
  assert(store.state.lanes.fixture.context?.percent > 0);
  const liveAnswer = store.state.answers.find(a => a.id === live.id);
  assert.match(liveAnswer?.text ?? '', /LIVE_OK/);
  console.log('PASS live question answered');
  const sessionDir = `${out}.d/sessions`;
  const messages = readdirSync(sessionDir).filter(f => f.endsWith('.jsonl')).flatMap(f =>
    readFileSync(join(sessionDir, f), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  assert(messages.some(e => e.type === 'message' && e.message.role === 'toolResult' &&
    e.message.toolName === 'ask_reviewer' && e.message.content.some(c => c.text === 'REVIEWER_OK')));
  assert.match(readFileSync(out, 'utf8'), /REVIEWER_OK/);
  console.log('PASS ask_reviewer received reviewer answer');
  console.log('PASS wait --for finished exited');
  console.log(`bridge e2e: 5/5 passed model=${model} steps=${store.state.lanes.fixture.steps} artifacts=${dir}`);
} catch (error) {
  console.error(`bridge e2e FAILED: ${error.message}\n${diagnostics}\nartifacts=${dir}`);
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise(done => server.close(done));
}
