import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { get } from 'node:http';
// @ts-expect-error plain ESM
import { BridgeStore, matchWait, parseWait, startBridge } from '../../tools/harness/pi/bridge/server.mjs';
// @ts-expect-error plain ESM
import { waitFor } from '../../tools/harness/pi/bridge/client.mjs';
// @ts-expect-error plain ESM
import { forkQuestion, formatStatus, parseArgs, snapshotSession } from '../../tools/harness/pi/bridge/cli.mjs';
// @ts-expect-error plain ESM
import { bridgeExtension } from '../../tools/harness/pi/bridge/extension-core.mjs';

const exec = promisify(execFile);
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-bridge-test-'));
  dirs.push(dir);
  return dir;
};
const close: (() => Promise<void>)[] = [];
// Fake pi tests workspace extensions, not whichever provider injected the parent agent.
// Keep every extension assertion intact, and restore the caller's environment after each test.
beforeEach(() => { vi.stubEnv('PI_PROVIDER_EXTENSION', undefined); });
afterEach(async () => {
  try { for (const dispose of close.splice(0)) await dispose(); }
  finally {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
});
async function serve() {
  const result = startBridge({ dir: temp(), port: 0 });
  await once(result.server, 'listening');
  close.push(() => new Promise(done => result.server.close(done)));
  const base = `http://127.0.0.1:${result.server.address().port}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { code: response.status, body: await response.json() };
  };
  const cli = (...args: string[]) => exec(process.execPath,
    [resolve('tools/harness/pi/bridge/cli.mjs'), ...args], {
      env: { ...process.env, PI_BRIDGE_PORT: String(result.server.address().port), PI_BRIDGE_POLL_MS: '10' },
    });
  return { ...result, base, post, cli };
}
function store(now = () => 1000000) { return new BridgeStore(temp(), now); }
function status(s: any, patch: any = {}) {
  s.status({ lane: 'G', phase: 'running', steps: 1, event: 'turn_end', ...patch });
}

describe('pi bridge persistent state and wait semantics', () => {
  it('atomically persists lanes, both question directions, answers and event cursor across restarts', () => {
    const dir = temp(), first = new BridgeStore(dir);
    status(first, { context: { tokens: 600, contextWindow: 1000, percent: 60 }, commit: 'abc' });
    const live = first.question({ lane: 'G', to: 'instance', question: 'progress?' });
    first.claim('G');
    const decision = first.question({ lane: 'G', to: 'reviewer', question: 'choose?', default: 'safe' });
    first.answer({ id: decision.id, text: 'safe' });
    const restored = new BridgeStore(dir);
    expect(restored.state).toEqual(first.state);
    expect(restored.claim('G').id).toBe(live.id);
    expect(restored.question({ lane: 'G', to: 'reviewer', question: 'again?' }).id).toBe(decision.id + 1);
    expect(JSON.parse(readFileSync(join(dir, 'bridge-state.json'), 'utf8')).lanes.G.commit).toBe('abc');
  });
  it('rejects corrupt persisted state instead of silently losing questions', () => {
    const dir = temp(); writeFileSync(join(dir, 'bridge-state.json'), '{broken');
    expect(() => new BridgeStore(dir)).toThrow();
  });
  it('rejects invalid ids, question fields, timeout bounds and unknown lanes without mutation', () => {
    const s = store();
    for (const lane of ['../G', '__proto__', '', 'a/b']) expect(() => status(s, { lane })).toThrow();
    expect(() => s.question({ lane: 'G', to: 'instance', question: 'x' })).toThrow('unknown lane');
    expect(() => s.question({ lane: 'G', to: 'reviewer', question: ' ' })).toThrow();
    expect(() => s.question({ lane: 'G', to: 'reviewer', question: 'x', timeout_s: -1 })).toThrow();
    expect(() => s.question({ lane: 'G', to: 'reviewer', question: 'x', options: [4] })).toThrow();
    expect(() => s.answer({ id: 19, text: 'x' })).toThrow('unknown question');
    expect(s.state.questions).toHaveLength(0);
    expect(s.state.nextId).toBe(1);
    expect(() => status(s, { context: { percent: 'bad' } })).toThrow();
  });
  it('claims one live question at a time, retries delivery, and never claims fork questions', () => {
    const s = store(); status(s);
    s.question({ lane: 'G', to: 'instance', mode: 'fork', question: 'copy' });
    const q = s.question({ lane: 'G', to: 'instance', question: 'live' });
    expect(s.claim('G').id).toBe(q.id); expect(s.claim('G').id).toBe(q.id);
    const a = s.answer({ id: q.id, text: 'first' });
    expect(s.answer({ id: q.id, text: 'retry' })).toEqual(a);
    expect(s.claim('G')).toBeNull(); expect(s.state.answers).toHaveLength(1);
  });
  it('uses first-answer-wins for deadline/reviewer races and records explicit default timeouts', () => {
    const s = store();
    const q = s.question({ lane: 'G', to: 'reviewer', question: 'choose', timeout_s: 0 });
    expect(s.answer({ id: q.id, text: 'fallback', timedOut: true }).timedOut).toBe(true);
    expect(s.answer({ id: q.id, text: 'late' }).text).toBe('fallback');
    expect(s.state.questions[0].state).toBe('timed_out');
  });
  it('keeps idle time tied to completed turns, not tool/status heartbeats', () => {
    let now = 1000; const s = store(() => now);
    status(s); now += 600000;
    s.status({ lane: 'G', event: 'tool_call' });
    expect(s.state.lanes.G.lastTurnAt).toBe(1000);
    expect(matchWait(s.state, ['stalled'], [], s.state.seq, now, 10).type).toBe('stalled');
    status(s); expect(matchWait(s.state, ['stalled'], [], s.state.seq, now, 10)).toBeNull();
  });
  it('does not report agent_end as finished, resets status for a replacement session', () => {
    const s = store(); status(s, { sessionId: 'old', context: { percent: 90 } });
    s.status({ lane: 'G', event: 'agent_end' });
    expect(matchWait(s.state, ['finished'])).toBeNull();
    s.status({ lane: 'G', event: 'agent_settled', phase: 'finished' });
    expect(matchWait(s.state, ['finished']).type).toBe('finished');
    status(s, { sessionId: 'new' });
    expect(s.state.lanes.G.context).toBeUndefined();
  });
  it('matches threshold equality, unknown context, lane filters and active-state questions', () => {
    const s = store(); status(s, { context: { percent: 60 } });
    expect(matchWait(s.state, ['context:60'], ['H'])).toBeNull();
    expect(matchWait(s.state, ['context:60']).type).toBe('context');
    status(s, { context: { percent: null } });
    expect(matchWait(s.state, ['context:0'])).toBeNull();
    const cursor = s.state.seq;
    s.question({ lane: 'G', to: 'instance', question: 'not for reviewer' });
    expect(matchWait(s.state, ['question'], [], cursor)).toBeNull();
    const q = s.question({ lane: 'G', to: 'reviewer', question: 'review?' });
    expect(matchWait(s.state, ['question'], ['G'], s.state.seq, 1000000).id).toBe(q.id);
    expect(matchWait(s.state, ['question'], ['G'], s.state.seq, q.expiresAt + 1)).toBeNull();
  });
  it('retains transient error/threshold events after a cursor even if status subsequently recovers', () => {
    const s = store(); status(s); const cursor = s.state.seq;
    status(s, { context: { percent: 70 }, errors: ['bad'] });
    status(s, { context: { percent: 20 }, errors: [] });
    expect(matchWait(s.state, ['error'], [], cursor).type).toBe('error');
    expect(matchWait(s.state, ['context:60'], [], cursor).type).toBe('context');
  });
  it('validates wait specs instead of blocking forever on typos', () => {
    for (const spec of ['', 'finish', 'context:101', 'context:-1', 'question,']) {
      expect(() => parseWait(spec)).toThrow();
    }
    expect(parseWait('question,finished,error,stalled,context:60')).toHaveLength(5);
  });
});

describe('pi bridge HTTP and CLI (no model)', () => {
  it('binds loopback only and rejects browser origins, rebinding hosts, bad JSON and unknown routes', async () => {
    const { server, base, post } = await serve();
    expect(server.address().address).toBe('127.0.0.1');
    expect((await fetch(base + '/state', { headers: { Origin: 'https://example.test' } })).status).toBe(403);
    const rebound = await new Promise(done => {
      get(base + '/state', { headers: { Host: 'evil.test' } }, response => {
        response.resume(); done(response.statusCode);
      });
    });
    expect(rebound).toBe(403);
    expect((await fetch(base + '/unknown')).status).toBe(404);
    expect((await fetch(base + '/status', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await post('/status', { lane: 'G', phase: 'running' })).code).toBe(200);
  });
  it('CLI status is two compact lines per lane and ask/answer/log commands round-trip', async () => {
    const { post, cli } = await serve();
    await post('/status', { lane: 'G', phase: 'running', steps: 4,
      context: { tokens: 600, contextWindow: 1000, percent: 60 }, model: 'fake/model', tools: [{ name: 'read' }] });
    const out = (await cli('status', '--lane', 'G')).stdout;
    expect(out.trim().split('\n')).toHaveLength(2); expect(out).toContain('steps=4 ctx=600/1000 (60.0%)');
    expect((await cli('ask', '--lane', 'G', '--live', 'progress?')).stdout).toContain('queued #1');
    await post('/answers', { id: 1, text: 'continuing' });
    expect((await cli('answers')).stdout).toContain('continuing');
    const q = (await post('/questions', { lane: 'G', to: 'reviewer', question: 'choose?', options: ['a', 'b'] })).body;
    expect((await cli('questions')).stdout).toContain('options=["a","b"]');
    expect((await cli('answer', '--id', String(q.id), 'a')).stdout).toContain('answered');
    expect((await cli('questions')).stdout).toBe('');
    await post('/status', { lane: 'G', phase: 'finished' });
    await expect(cli('ask', '--lane', 'G', 'too late')).rejects.toThrow();
  });
  it('wait CLI blocks then exits with exactly one line on a new finished event', async () => {
    const { store: s, cli } = await serve(); status(s);
    const waiting = cli('wait', '--for', 'finished', '--lanes', 'G', '--timeout-s', '4');
    await new Promise(done => setTimeout(done, 120));
    status(s, { phase: 'finished' });
    expect((await waiting).stdout).toBe('G finished\n');
  });
  it('wait handles queued questions, late startup, lane filters, timeout and cancellation', async () => {
    const { store: s, base } = await serve(); status(s);
    const q = s.question({ lane: 'G', to: 'reviewer', question: 'decision?' });
    expect((await waitFor({ base, spec: 'question', poll: 5 })).id).toBe(q.id);
    await expect(waitFor({ base, spec: 'finished', lanes: ['H'], timeout: 20, poll: 5 })).rejects.toThrow('timeout');
    await expect(waitFor({ base, spec: 'finished', signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it('CLI validates conflicting flags and unknown options; unknown context is not displayed as zero', () => {
    expect(() => parseArgs(['ask', '--live', '--fork'])).toThrow();
    expect(() => parseArgs(['wait', '--oops'])).toThrow();
    expect(() => parseArgs(['status', '--lane'])).toThrow();
    expect(formatStatus({ lane: 'G', lastTurnAt: Date.now() })).toContain('ctx=? (?%)');
  });
  it('snapshots the published active branch, excludes a concurrent tail and never changes the source', () => {
    const file = join(temp(), 'session.jsonl');
    const records = [{ type: 'session', id: 'session' },
      { type: 'message', id: 'a', parentId: null }, { type: 'message', id: 'b', parentId: 'a' },
      { type: 'message', id: 'abandoned', parentId: 'a' }, { type: 'message', id: 'tail', parentId: 'b' }];
    const original = records.map(r => JSON.stringify(r)).join('\n') + '\n{"partial":';
    writeFileSync(file, original);
    const copy = snapshotSession(file, 'b').trim().split('\n').map((line: string) => JSON.parse(line));
    expect(copy.map((e: any) => e.id)).toEqual(['session', 'a', 'b']);
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(() => snapshotSession(file, 'missing')).toThrow();
  });
});

describe('pi bridge workspace-only driver and launcher', () => {
  it('fork invocation disables ALL tools and resources and never resumes the original in place', async () => {
    const dir = temp(), source = join(dir, 'source.jsonl');
    const original = JSON.stringify({ type: 'session', id: 's' }) + '\n' + JSON.stringify({
      type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'ORCHID_742' },
    }) + '\n';
    writeFileSync(source, original);
    const answer = await forkQuestion({ sessionFile: source, leafId: 'a', model: 'fake/model' }, 'token?', {
      env: { ...process.env, PI_BIN: resolve('tests/fixtures/pi/fake-pi.mjs') },
    });
    expect(answer).toBe('ORCHID_742'); expect(readFileSync(source, 'utf8')).toBe(original);
  });
  it('driver still works with the bridge disabled and adds only a workspace -e when enabled', async () => {
    const { cli, server } = await serve();
    for (const enabled of ['0', '1']) {
      const dir = temp(), prompt = join(dir, 'prompt.md'), out = join(dir, 'result.txt');
      writeFileSync(prompt, 'tiny fixture task');
      const result = await exec('bash', [resolve('tools/harness/pi/run-pi.sh'), dir, prompt, out], {
        env: { ...process.env, PI_BIN: resolve('tests/fixtures/pi/fake-pi.mjs'), PI_MODEL: 'fake/model',
          PI_EXTRA_ARGS: '', PI_BRIDGE: enabled, PI_LANE: 'G', PI_BRIDGE_PORT: String(server.address().port) },
      });
      expect(result.stderr).toContain('exit=0'); expect(readFileSync(out, 'utf8')).toContain('fixture finished');
      if (enabled === '1') {
        expect(readFileSync(`${out}.d/bridge-brief.md`, 'utf8')).toContain('Never ask for routine confirmations');
        expect((await cli('status', '--lane', 'G')).stdout).toContain('finished');
      }
    }
  });
  it('launcher rejects equivalent numeric ports with leading zeros before starting a bridge', async () => {
    const dir = temp(), brief = join(dir, 'brief.md'), manifest = join(dir, 'lanes');
    writeFileSync(brief, 'fixture task'); writeFileSync(manifest, `A|05185|${brief}\n`);
    await expect(exec('bash', [resolve('tools/harness/pi/launch-lanes.sh'),
      resolve('.'), join(dir, 'run'), manifest], { env: { ...process.env, PI_BRIDGE_PORT: '5190' } }))
      .rejects.toThrow('invalid port (no leading zeros)');
    expect(existsSync(join(dir, 'run/bridge.pid'))).toBe(false);
  });
  it('launcher creates independent clones, branches, ports, scratch and composed briefs without a model', async () => {
    const dir = temp(), source = join(dir, 'source'), run = join(dir, 'run'), manifest = join(dir, 'lanes');
    mkdirSync(source); writeFileSync(join(source, 'fixture.md'), 'original kit fixture');
    const git = (...args: string[]) => exec('git', ['-C', source, ...args]);
    await git('init', '-q'); await git('add', '.');
    await git('-c', 'user.name=Bridge Test', '-c', 'user.email=bridge@example.invalid', 'commit', '-qm', 'fixture');
    const common = join(dir, 'common.md'), brief = join(dir, 'lane.md');
    writeFileSync(common, 'COMMON_SENTINEL'); writeFileSync(brief, 'LANE_SENTINEL');
    writeFileSync(manifest, `A|5281|${brief}\nB|5282|${brief}\n`);
    // Reserve a free bridge port, then release it before starting the launcher.
    const reservation = await serve();
    const port = reservation.server.address().port;
    await new Promise<void>(done => reservation.server.close(done)); close.pop();
    try {
      const result = await exec('bash', [resolve('tools/harness/pi/launch-lanes.sh'), source, run, manifest, common], {
        env: { ...process.env, PI_MODEL: 'fake/model', PI_BIN: resolve('tests/fixtures/pi/fake-pi.mjs'),
          PI_BRIDGE_PORT: String(port), PI_LANES_SANDBOX: '0', PI_EXTRA_ARGS: '', PI_LANES_AGENT_SEED: '' },
      });
      expect(result.stdout.trim().split('\n')).toHaveLength(2);
      for (const lane of ['A', 'B']) {
        const clone = join(run, `lane-${lane}`), scratch = join(run, `scratch-${lane}`);
        expect((await exec('git', ['-C', clone, 'branch', '--show-current'])).stdout.trim()).toBe(`bridge/${lane}`);
        expect((await exec('git', ['-C', clone, 'remote'])).stdout).toBe('');
        expect(readFileSync(join(scratch, 'brief.md'), 'utf8')).toMatch(/COMMON_SENTINEL[\s\S]*LANE_SENTINEL/);
        expect(readFileSync(join(scratch, 'result.txt'), 'utf8')).toContain('fixture finished');
        expect(existsSync(join(clone, '.git/objects/info/alternates'))).toBe(false);
        writeFileSync(join(clone, 'fixture.md'), 'lane change');
        expect(readFileSync(join(source, 'fixture.md'), 'utf8')).toBe('original kit fixture');
      }
    } finally {
      try { process.kill(Number(readFileSync(join(run, 'bridge.pid'), 'utf8')), 'SIGTERM'); } catch { /* no child */ }
    }
  });
});

// Exercise actual extension hooks with a fake pi host. Host-only schema imports stay in the tiny loader.
describe('pi bridge extension boundaries', () => {
  async function extension() {
    const service = await serve();
    const previous = { lane: process.env.PI_LANE, port: process.env.PI_BRIDGE_PORT };
    process.env.PI_LANE = 'G'; process.env.PI_BRIDGE_PORT = String(service.server.address().port);
    close.push(async () => {
      if (previous.lane === undefined) delete process.env.PI_LANE; else process.env.PI_LANE = previous.lane;
      if (previous.port === undefined) delete process.env.PI_BRIDGE_PORT;
      else process.env.PI_BRIDGE_PORT = previous.port;
    });
    const hooks: Record<string, (...args: any[]) => Promise<void>> = {}, sent: string[] = [], registered: any[] = [];
    const pi = { on: (name: string, handler: any) => { hooks[name] = handler; },
      registerTool: (tool: any) => registered.push(tool), appendEntry: () => {},
      sendUserMessage: (message: string) => sent.push(message) };
    const schema = new Proxy({}, { get: () => () => ({}) });
    bridgeExtension(pi, schema);
    const entries: any[] = [];
    const ctx = { cwd: temp(), model: { provider: 'fake', id: 'model' }, getContextUsage: () => ({ percent: 25 }),
      sessionManager: { getEntries: () => entries, getBranch: () => entries, getSessionId: () => 's1',
        getSessionFile: () => '/private/session.jsonl', getLeafId: () => null } };
    await hooks.session_start({}, ctx);
    return { ...service, hooks, sent, tool: registered[0], ctx, entries };
  }
  it('injects live steering only at boundaries and captures NEXT assistant text, not the prior text', async () => {
    const { store: s, hooks, sent, ctx } = await extension();
    const q = s.question({ lane: 'G', to: 'instance', question: 'what now?' });
    const assistant = (text: string) => ({ message: { role: 'assistant', content: [{ type: 'text', text }] } });
    await hooks.turn_end(assistant('prior text'), ctx);
    expect(sent).toHaveLength(1); expect(sent[0]).toContain('Reviewer bridge question');
    expect(s.state.answers).toHaveLength(0);
    await hooks.turn_end(assistant('brief answer'), ctx);
    expect(s.state.answers[0]).toMatchObject({ id: q.id, text: 'brief answer' });
    await hooks.agent_end({}, ctx); expect(s.state.lanes.G.phase).toBe('running');
    await hooks.agent_settled({ aborted: false }, ctx); expect(s.state.lanes.G.phase).toBe('finished');
  });
  it('ask_reviewer receives a human answer and explicitly returns the default on timeout', async () => {
    const { store: s, tool } = await extension();
    const waiting = tool.execute('call', { question: 'choose?', timeout_s: 2 }, undefined);
    for (let i = 0; i < 100 && !s.state.questions.length; i++) await new Promise(done => setTimeout(done, 5));
    s.answer({ id: s.state.questions[0].id, text: 'reviewer choice' });
    expect((await waiting).content[0].text).toBe('reviewer choice');
    const result = await tool.execute('call', { question: 'timeout?', default: 'safe', timeout_s: 0 }, undefined);
    expect(result.content[0].text).toContain('Reviewer timeout; using default: safe');
    expect(result.details.timedOut).toBe(true);
  });
  it('ask_reviewer honors cancellation while waiting instead of waiting for its full timeout', async () => {
    const { store: s, tool } = await extension();
    const controller = new AbortController();
    const waiting = tool.execute('call', { question: 'pending decision', timeout_s: 900 }, controller.signal);
    const rejected = expect(waiting).rejects.toThrow();
    for (let i = 0; i < 100 && !s.state.questions.length; i++) await new Promise(done => setTimeout(done, 5));
    controller.abort();
    await rejected;
    expect(s.state.answers).toHaveLength(0);
  });
  it('records context, usage, tools and errors from host events, without fabricating unknown tokens', async () => {
    const { store: s, hooks, ctx, entries } = await extension();
    entries.push({ type: 'message', message: { role: 'assistant', usage: { cost: { total: 0.25 } } } },
      { type: 'usage', usage: { cost: { total: 0.1 } } });
    await hooks.tool_call({ toolName: 'read' }, ctx);
    await hooks.tool_result({ toolName: 'read', isError: true, content: [{ type: 'text', text: 'missing' }] });
    await hooks.turn_end({ message: { role: 'assistant', content: [] } }, ctx);
    expect(s.state.lanes.G).toMatchObject({ steps: 1, cost: 0.35, context: { percent: 25 },
      tools: [{ name: 'read' }], errors: [{ message: 'read: missing' }] });
  });
});
