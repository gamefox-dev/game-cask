import { afterEach, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error plain ESM
import { contextExtension } from '../../tools/harness/pi/bridge/context-core.mjs';
// @ts-expect-error plain ESM
import { BridgeStore, matchWait, startBridge } from '../../tools/harness/pi/bridge/server.mjs';
const exec = promisify(execFile), here = resolve('tools/harness/pi');
const dirs: string[] = [], children: ReturnType<typeof spawn>[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'bgt-pi-robust-')); dirs.push(d); return d; };
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const env = (patch: NodeJS.ProcessEnv = {}) => ({ ...process.env, PI_BRIDGE: '0', PI_PROVIDER_EXTENSION: '',
  PI_MODEL: 'fake/model', PI_EXTRA_ARGS: '', PI_MAX_ATTEMPTS: '2', PI_RETRY_BACKOFF: '0', PI_RETRY_JITTER: '0',
  PI_TIMEOUT: '20', BGT_HEAVY_HELD: '', BGT_HEAVY_LOG: '', BGT_HEAVY_MEMINFO_FILE: undefined, ...patch });
const executable = (p: string, content: string) => { writeFileSync(p, content); chmodSync(p, 0o755); return p; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await sleep(20); }
  throw new Error('fixture deadline');
}
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGTERM');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function contextHost(config: Record<string, string | undefined> = {}) {
  const hooks: Record<string, any> = {}, registered: any[] = [], sent: string[] = [];
  contextExtension({ on: (n: string, h: any) => { hooks[n] = h; }, registerTool: (t: any) => registered.push(t),
    sendUserMessage: (s: string) => sent.push(s) }, new Proxy({}, { get: () => () => ({}) }), config);
  let usage: any = { tokens: 182000, contextWindow: 1000000, percent: 18.2 };
  const ctx = { getContextUsage: () => usage };
  const event = { content: [{ type: 'text', text: 'original' }, { type: 'image', data: 'unchanged' }],
    isError: true, structuredContent: { original: true } };
  return { hooks, tool: registered[0], sent, ctx, event, usage: (u: any) => { usage = u; } };
}
describe('model-visible context and checkpoint', () => {
  it('reports exact host estimates on demand, preserving unknown values rather than inventing zero', async () => {
    const h = contextHost();
    expect((await h.tool.execute('', {}, undefined, undefined, h.ctx)).content[0].text).toContain('182000/1000000 tokens, 18.2%');
    h.usage({ tokens: null, contextWindow: 1000000, percent: null });
    expect((await h.tool.execute('', {}, undefined, undefined, h.ctx)).content[0].text).toContain('?/1000000 tokens, ?%');
    h.usage(undefined);
    expect((await h.tool.execute('', {}, undefined, undefined, h.ctx)).details.usage).toBeNull();
  });
  it('annotates one outer result every N turns, not nested codemode calls; preserves content/data/error contract', () => {
    const h = contextHost({ PI_CONTEXT_EVERY_TURNS: '2' });
    expect(h.hooks.tool_result({ ...h.event, parentToolCallId: 'outer' }, h.ctx)).toBeUndefined();
    const result = h.hooks.tool_result(h.event, h.ctx);
    expect(result.content.slice(0, 2)).toEqual(h.event.content);
    expect(result.structuredContent).toEqual(h.event.structuredContent);
    expect(result.isError).toBeUndefined(); // omitted: host keeps the original error/usage/details
    expect(result.content[2].text).toContain('[context:');
    expect(h.hooks.tool_result(h.event, h.ctx)).toBeUndefined();
    h.hooks.turn_end({}, h.ctx);
    expect(h.hooks.tool_result(h.event, h.ctx)).toBeUndefined();
    h.hooks.turn_end({}, h.ctx);
    expect(h.hooks.tool_result(h.event, h.ctx).content[2].text).toContain('18.2%');
    h.hooks.session_start();
    expect(h.hooks.tool_result(h.event, h.ctx)).toBeDefined();
  });
  it('checkpoints at equality, latches after compaction, and steers once even on a text-only final turn', async () => {
    const h = contextHost({ PI_CHECKPOINT_TOKENS: '182000', PI_CONTEXT_EVERY_TURNS: '99' });
    h.hooks.turn_end({}, h.ctx);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/CHECKPOINT.*182000.*Commit your work, write your handoff, and stop/s);
    h.usage({ tokens: 1000, contextWindow: 1000000, percent: 0.1 });
    h.hooks.turn_end({}, h.ctx);
    expect(h.sent).toHaveLength(1);
    expect((await h.tool.execute('', {}, undefined, undefined, h.ctx)).details.checkpoint).toBe(true);
    h.hooks.session_start();
    expect((await h.tool.execute('', {}, undefined, undefined, h.ctx)).details.checkpoint).toBe(false);
  });
  it('does not checkpoint unknown or below-threshold usage, and rejects invalid operator settings', () => {
    const h = contextHost({ PI_CHECKPOINT_TOKENS: '182001' });
    h.hooks.turn_end({}, h.ctx); h.usage(undefined); h.hooks.turn_end({}, h.ctx);
    expect(h.sent).toEqual([]);
    for (const config of [{ PI_CONTEXT_EVERY_TURNS: '0' }, { PI_CHECKPOINT_TOKENS: 'NaN' }, { PI_CHECKPOINT_TOKENS: '-1' }]) {
      expect(() => contextHost(config)).toThrow('invalid');
    }
  });
});

// Synthetic provider stdout stream + session; no model, credentials or network requests.
function provider(dir: string) {
  return executable(join(dir, 'provider.mjs'), `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const a=process.argv.slice(2), d=a[a.indexOf('--session-dir')+1];
const n=Number(d.match(/\\.attempt-(\\d+)\\.d/)?.[1] ?? 1);
if(n>1) { assert(a.includes('--fork')); assert.match(readFileSync(a[a.indexOf('--fork')+1],'utf8'),/SESSION_FACT/); }
else assert(!a.includes('--fork'));
appendFileSync(process.env.FAKE_TRACE,JSON.stringify({n,at:Date.now(),args:a,agent:process.env.PI_CODING_AGENT_DIR,settings:JSON.parse(readFileSync(process.env.PI_CODING_AGENT_DIR+'/settings.json'))})+'\\n');
const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:'SESSION_FACT attempt='+n}]};
writeFileSync(d+'/session.jsonl',JSON.stringify({type:'session',id:'s'+n})+'\\n'+JSON.stringify({type:'message',id:'m'+n,parentId:null,message})+'\\n');
if(n<=Number(process.env.FAKE_FAILURES ?? 1)) { console.log(JSON.stringify({type:'provider_error',errorMessage:process.env.FAKE_ERROR})); process.exit(17); }
`);
}
async function drive(patch: NodeJS.ProcessEnv = {}) {
  const dir = temp(), out = join(dir, 'out'), prompt = join(dir, 'brief'), trace = join(dir, 'trace');
  writeFileSync(prompt, 'task'); let code = 0;
  try { await exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({
    PI_BIN: provider(dir), FAKE_TRACE: trace, FAKE_ERROR: 'HTTP 503 unavailable', ...patch }) }); }
  catch (e: any) { code = e.code; }
  return { dir, out, code, trace: readFileSync(trace, 'utf8').trim().split('\n').map(l => JSON.parse(l)), history: json(out + '.d/driver.json') };
}
describe('provider stream retry and reset scheduling', () => {
  it('does not inherit a parent driver retry fork, but forks its own failed attempt', async () => {
    const r = await drive({ PI_FORK_SESSION: '/parent-driver/private-session.jsonl' });
    expect(r.code).toBe(0);
    expect(r.trace[0].args).not.toContain('--fork');
    const index = r.trace[1].args.indexOf('--fork');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(r.trace[1].args[index + 1]).toBe(realpathSync(r.out + '.d/sessions/session.jsonl'));
    expect(r.history.attempts.map((a: any) => a.exit)).toEqual([17, 0]);
  });
  it.each(['currently overloaded', 'Request timed out', 'HTTP 501 upstream', 'HTTP 599 upstream',
    '429 usage_limit_reached', 'status: 429', 'error 500'])('retries transient %s from this attempt stream only', async error => {
    const r = await drive({ FAKE_ERROR: error });
    expect(r.code).toBe(0); expect(r.history.attempts.map((a: any) => a.exit)).toEqual([17, 0]);
    expect(r.history.retries).toHaveLength(1);
    expect(json(r.out + '.d/retries.jsonl')).toMatchObject({ nextAttempt: 2, reason: 'transient-provider' });
    expect(readFileSync(r.out + '.d/stderr.txt', 'utf8')).toBe('');
  });
  it.each(['HTTP 401 invalid credentials', 'HTTP 403 forbidden', 'bad model name'])('does not retry permanent %s', async error => {
    const r = await drive({ FAKE_ERROR: error });
    expect(r.code).toBe(17); expect(r.history.attempts).toHaveLength(1);
  });
  it('honors resets_in_seconds rather than exponential backoff', async () => {
    const r = await drive({ FAKE_ERROR: 'HTTP 429 {"error":{"type":"usage_limit_reached","resets_in_seconds":0.35}}' });
    expect(r.code).toBe(0); expect(r.trace[1].at - r.trace[0].at).toBeGreaterThanOrEqual(350);
    expect(r.history.retries[0]).toMatchObject({ reason: 'provider-reset', delaySeconds: 0.35 });
  });
  it('caps the TOTAL wait and never retries early when a reset exceeds the remaining budget', async () => {
    const r = await drive({ FAKE_ERROR: 'HTTP 429 {"resets_in_seconds":0.15}', FAKE_FAILURES: '3',
      PI_MAX_ATTEMPTS: '4', PI_RETRY_MAX_WAIT: '0.25' });
    expect(r.code).toBe(17); expect(r.history.attempts).toHaveLength(2);
    expect(r.history.retries.map((p: any) => p.budgetExceeded)).toEqual([false, true]);
    expect(existsSync(r.out + '.attempt-3.d')).toBe(false);
    expect(readFileSync(r.out + '.d/retries.jsonl', 'utf8').trim().split('\n')).toHaveLength(2);
  });
  it('parses absolute epoch/ISO/millisecond resets, escaped bodies, jitter and malformed fields deterministically', async () => {
    const { stdout } = await exec('python3', ['-c', `import sys,json;sys.path.insert(0,sys.argv[1]);from retries import retry_plan
cases=['HTTP 429 {"resets_at":1005}', 'HTTP 429 {"resets_at":"1970-01-01T00:16:45Z"}',
       'HTTP 429 {"resets_in_seconds":5}', 'HTTP 429 {"resets_at":1700000005000}',
       'HTTP 429 {"resets_in_seconds":"nan"}', 'HTTP 429 {"resets_at":900}']
print(json.dumps([retry_plan(s,2,3,1700000000 if '170000' in s else 1000,.25) for s in cases]))`, here]);
    expect(JSON.parse(stdout).map((p: any) => p.delaySeconds)).toEqual([5.25, 5.25, 5.25, 5.25, 6.25, 0.25]);
  });
});

describe('isolated codemode configuration', () => {
  it.each(['only', 'on', 'off', 'default'])('sets %s in per-attempt settings and argv without editing source agent settings', async mode => {
    const seed = temp(); writeFileSync(join(seed, 'settings.json'), '{"KEEP":"unchanged"}');
    writeFileSync(join(seed, 'auth.json'), '{}');
    const r = await drive({ PI_CODEMODE: mode === 'default' ? undefined : mode, PI_CODING_AGENT_DIR: seed });
    expect(r.code).toBe(0);
    for (const row of r.trace) {
      expect(row.agent).toContain('.d/agent'); expect(row.agent).not.toBe(seed);
      expect(row.args.includes('builtin:codemode')).toBe(mode !== 'off');
      expect(row.args).toContain('--no-extensions');
      expect(row.args).toContain(mode === 'off' ? '-codemode' : '+codemode');
      expect(row.settings.codemode.mode).toBe(mode === 'default' || mode === 'only' ? 'only' : 'on');
      expect(row.settings.defaultTools).toEqual([mode === 'off' ? '-codemode' : '+codemode']);
      expect(row.args.some((a: string) => a.endsWith('/bridge/context.js'))).toBe(true);
    }
    expect(readFileSync(join(seed, 'settings.json'), 'utf8')).toBe('{"KEEP":"unchanged"}');
    expect(r.trace[0].agent).not.toBe(r.trace[1].agent);
  });
  it('rejects invalid codemode before invoking pi', async () => {
    const dir = temp(), prompt = join(dir, 'brief'); writeFileSync(prompt, 'task');
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, prompt, join(dir, 'out')], { env: env({ PI_CODEMODE: 'bad' }) }))
      .rejects.toThrow('PI_CODEMODE');
  });
});

describe('memory headroom FIFO admission', () => {
  it('parses real native readings conservatively, rejects missing/corrupt readings, ignores swap', async () => {
    const { stdout } = await exec('python3', ['-c', `import sys,json;sys.path.insert(0,sys.argv[1]);from memory import linux_available,mac_available
raw='Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free: 100.\\nPages inactive: 200.\\nPages speculative: 10.\\nPages active: 999999.\\nPages occupied by compressor: 999999.'
assert mac_available(raw, 16*1024**3)==310*16384
assert linux_available('MemFree: 1 kB\\nMemAvailable: 2048000 kB\\nSwapFree: 0 kB')==2048000*1024
for f in [lambda:linux_available('MemFree: 5000 kB'),lambda:mac_available(raw,1),lambda:mac_available('bad',100)]:
 try:f();raise AssertionError('accepted corrupt')
 except ValueError:pass
print('ok')`, join(here, 'shim')]);
    expect(stdout.trim()).toBe('ok');
  });
  it.each([1, 2])('holds FIFO tickets on low/unknown memory and admits in order with %i slots', async slots => {
    const d = mkdtempSync(process.platform === 'darwin' ? '/private/tmp/bgt-pi-memory-' : '/tmp/bgt-pi-memory-'); dirs.push(d);
    const mem = join(d, 'meminfo'), prefix = join(d, 'gate'), trace = join(d, 'trace');
    writeFileSync(mem, 'MemAvailable: 524288 kB\n');
    const real = executable(join(d, 'real'), '#!/bin/bash\necho "$3" >> "$TRACE"; sleep 0.2\n');
    const run = (tag: string) => {
      const child = spawn(join(here, 'shim/npm'), ['run', 'test', tag], { env: env({ BGT_REAL_NPM: real,
        BGT_HEAVY_LOCK_PREFIX: prefix, BGT_HEAVY_SLOTS: String(slots), BGT_HEAVY_MIN_FREE_MB: '1024',
        BGT_HEAVY_MEMINFO_FILE: mem, TRACE: trace }), stdio: 'ignore' }); children.push(child);
      return { closed: once(child, 'close'), pid: child.pid };
    };
    const a = run('a');
    await until(() => existsSync(prefix + '.log') && readFileSync(prefix + '.log', 'utf8').includes('wait memory free_mb=512'));
    const b = run('b');
    await until(() => readFileSync(prefix + '.log', 'utf8').includes('wait fifo'));
    expect(existsSync(trace)).toBe(false);
    writeFileSync(mem, 'unavailable');
    await until(() => readFileSync(prefix + '.log', 'utf8').includes('memory unavailable'));
    expect(existsSync(trace)).toBe(false);
    writeFileSync(mem, 'MemAvailable: 1048576 kB\n');
    expect((await a.closed)[0]).toBe(0); expect((await b.closed)[0]).toBe(0);
    const log = readFileSync(prefix + '.log', 'utf8');
    // FIFO governs admission. With two held slots the OS may schedule command b before command a.
    expect([...log.matchAll(/ticket=\S+-(\d+) granted/g)].map(m => Number(m[1]))).toEqual([a.pid, b.pid]);
    const actual = readFileSync(trace, 'utf8');
    expect(actual.trim().split('\n').sort()).toEqual(['a', 'b']);
    if (slots === 1) expect(actual).toBe('a\nb\n');
    expect(log).toContain('granted memory free_mb=1024');
  }, 15_000);
  it('fails invalid thresholds closed, and defaults to 1024 MB without an operator value', async () => {
    const d = temp(), mem = join(d, 'mem'); writeFileSync(mem, 'MemAvailable: 1048575 kB\n');
    await expect(exec('python3', ['-I', join(here, 'shim/memory.py')], { env: env({
      BGT_HEAVY_MIN_FREE_MB: undefined, BGT_HEAVY_MEMINFO_FILE: mem }) })).rejects.toMatchObject({ code: 75 });
    await expect(exec('python3', ['-I', join(here, 'shim/memory.py')], { env: env({
      BGT_HEAVY_MIN_FREE_MB: '-1' }) })).rejects.toMatchObject({ code: 2 });
  });
});

describe('dead driver recovery and operator release', () => {
  it('rejects live replacements, preserves PID/lease across session forks and detects PID incarnation reuse', async () => {
    const { stdout } = await exec('python3', ['-I', join(here, 'process-start.py'), String(process.pid)]);
    const s = new BridgeStore(temp());
    s.lifecycle({ action: 'started', lane: 'A', runId: 'old', pid: process.pid, start: stdout.trim() });
    s.status({ lane: 'A', runId: 'old', sessionId: 's1' }); s.status({ lane: 'A', runId: 'old', sessionId: 's2' });
    expect(s.state.lanes.A.driverPid).toBe(process.pid);
    expect(() => s.lifecycle({ action: 'started', lane: 'A', runId: 'new' })).toThrow('already running');
    s.state.lanes.A.driverStart = 'wrong incarnation';
    s.lifecycle({ action: 'started', lane: 'A', runId: 'new' });
    expect(s.state.events.some((e: any) => e.type === 'stale-driver')).toBe(true);
    expect(() => s.lifecycle({ action: 'ended', lane: 'A', runId: 'old', code: 0 })).toThrow('stale');
  });
  it('refreshes driver-only heartbeats, expires leases, and reloads persisted metadata', () => {
    let now = 1000; const d = temp(), s = new BridgeStore(d, () => now);
    s.lifecycle({ action: 'started', lane: 'A', runId: 'old', pid: process.pid });
    now += 100000; s.lifecycle({ action: 'heartbeat', lane: 'A', runId: 'old' });
    now += 100000;
    const restored = new BridgeStore(d, () => now);
    expect(() => restored.lifecycle({ action: 'started', lane: 'A', runId: 'new' })).toThrow('already running');
    now += 21000;
    restored.lifecycle({ action: 'started', lane: 'A', runId: 'new' });
    expect(() => restored.lifecycle({ action: 'heartbeat', lane: 'A', runId: 'old' })).toThrow('stale');
    expect(matchWait(restored.state, ['finished'])).toBeNull();
  });
  it('relaunches after a real driver SIGKILL without an ended event', async () => {
    const d = temp(), prompt = join(d, 'brief'), trace = join(d, 'trace'); writeFileSync(prompt, 'task');
    const { server, store } = startBridge({ dir: join(d, 'bridge'), port: 0 }); await once(server, 'listening');
    try {
      const e = env({ PI_BRIDGE: '1', PI_LANE: 'A', PI_BRIDGE_PORT: String(server.address().port), PI_MAX_ATTEMPTS: '1',
        PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'), FAKE_TRACE: trace, FAKE_DELAY: '500' });
      const child = spawn('bash', [join(here, 'run-pi.sh'), d, prompt, join(d, 'out')], { env: e, stdio: 'ignore' });
      children.push(child); const closed = once(child, 'close');
      await until(() => existsSync(trace)); child.kill('SIGKILL'); await closed;
      expect(store.state.lanes.A.driverExitedAt).toBeUndefined(); const old = store.state.lanes.A.runId;
      await expect(exec('bash', [join(here, 'run-pi.sh'), d, prompt, join(d, 'out2')], { env: e })).rejects.toMatchObject({ code: 17 });
      expect(store.state.lanes.A.runId).not.toBe(old); expect(store.state.lanes.A.driverExit).toBe(17);
    } finally { await new Promise<void>(r => server.close(r)); }
  }, 15_000);
  it('the real driver heartbeats during provider-reset sleep, and cancellation cannot start a retry', async () => {
    const d = temp(), prompt = join(d, 'brief'); writeFileSync(prompt, 'task');
    const { server, store: s } = startBridge({ dir: join(d, 'bridge'), port: 0 }); await once(server, 'listening');
    const out = join(d, 'out');
    try {
      const child = spawn('bash', [join(here, 'run-pi.sh'), d, prompt, out], { env: env({
        PI_BRIDGE: '1', PI_LANE: 'A', PI_BRIDGE_PORT: String(server.address().port),
        PI_BIN: provider(d), FAKE_TRACE: join(d, 'trace'), FAKE_ERROR: 'HTTP 429 {"resets_in_seconds":60}' }), stdio: 'ignore' });
      children.push(child); const closed = once(child, 'close');
      await until(() => existsSync(out + '.d/retries.jsonl'));
      await sleep(16000);
      expect(s.state.lanes.A.heartbeatAt - s.state.lanes.A.driverStartedAt).toBeGreaterThanOrEqual(14000);
      expect(matchWait(s.state, ['finished'])).toBeNull();
      child.kill('SIGTERM'); expect((await closed)[0]).toBe(143);
      expect(existsSync(out + '.attempt-2.d')).toBe(false);
      expect(json(out + '.d/driver.json').retries).toHaveLength(1);
    } finally { await new Promise<void>(r => server.close(r)); }
  }, 30_000);
  it('CLI release allows legacy relaunch without claiming the worker exited, and rejects late writes', async () => {
    const { server, store: s } = startBridge({ dir: temp(), port: 0 }); await once(server, 'listening');
    try {
      s.lifecycle({ action: 'started', lane: 'A', runId: 'old' });
      await exec('node', [join(here, 'bridge/cli.mjs'), 'release', '--lane', 'A'], { env: env({ PI_BRIDGE_PORT: String(server.address().port) }) });
      expect(s.state.lanes.A.releasedAt).toBeDefined(); expect(matchWait(s.state, ['finished'])).toBeNull();
      expect(() => s.status({ lane: 'A', runId: 'old' })).toThrow('released');
      expect(() => s.lifecycle({ action: 'ended', lane: 'A', runId: 'old', code: 0 })).toThrow('stale');
      s.lifecycle({ action: 'started', lane: 'A', runId: 'new' });
      expect(s.state.lanes.A.runId).toBe('new');
    } finally { await new Promise<void>(r => server.close(r)); }
  });
});
