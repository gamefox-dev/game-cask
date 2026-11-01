import { afterEach, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error plain ESM
import { BridgeStore, matchWait, parseWait, startBridge } from '../../tools/harness/pi/bridge/server.mjs';
const exec = promisify(execFile);
const here = resolve('tools/harness/pi');
const dirs: string[] = [];
const children: ReturnType<typeof spawn>[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'bgt-harness-')); dirs.push(dir); return dir; };
const env = (patch: NodeJS.ProcessEnv = {}) => ({ ...process.env, PI_BRIDGE: '0', PI_PROVIDER_EXTENSION: '',
  PI_MODEL: 'fake/model', PI_EXTRA_ARGS: '', PI_MAX_ATTEMPTS: '1', PI_TIMEOUT: '30', ...patch });
const script = (file: string, text: string) => { writeFileSync(file, `#!/bin/bash\nset -eu\n${text}\n`); chmodSync(file, 0o755); return file; };
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('fixture deadline');
}
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGTERM');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('process-owned bridge lifecycle', () => {
  it('ignores stale settled/events/exit, preserves driver identity across forks, finishes failures with actual code', () => {
    const s = new BridgeStore(temp());
    s.lifecycle({ action: 'started', lane: 'A', runId: 'old' });
    s.lifecycle({ action: 'ended', lane: 'A', runId: 'old', code: 4 });
    const cursor = 0;
    s.lifecycle({ action: 'started', lane: 'A', runId: 'new' });
    expect(() => s.lifecycle({ action: 'ended', lane: 'A', runId: 'old', code: 0 })).toThrow('stale');
    expect(() => s.status({ lane: 'A', runId: 'old', phase: 'finished' })).toThrow('stale');
    expect(() => s.lifecycle({ action: 'started', lane: 'A', runId: 'nested' })).toThrow('already running');
    s.status({ lane: 'A', runId: 'new', sessionId: 's1', phase: 'finished', event: 'agent_settled' });
    expect(matchWait(s.state, ['finished'], [], cursor)).toBeNull();
    s.status({ lane: 'A', runId: 'new', sessionId: 's2', phase: 'running' });
    expect(s.state.lanes.A.runId).toBe('new');
    s.lifecycle({ action: 'ended', lane: 'A', runId: 'new', code: 17 });
    expect(matchWait(s.state, ['finished'], [], cursor)).toMatchObject({ code: 17 });
    s.status({ lane: 'A', runId: 'new', phase: 'running' });
    expect(s.state.lanes.A.driverExit).toBe(17);
    const n = s.state.seq;
    s.lifecycle({ action: 'ended', lane: 'A', runId: 'new', code: 0 });
    expect(s.state.seq).toBe(n);
  });
  it('accepts stalled[:minutes], validates grammar, and matches supervisor exit despite lane filters', () => {
    const s = new BridgeStore(temp(), () => 1000);
    s.status({ lane: 'A', phase: 'running' });
    expect(parseWait('question,finished,error,stalled:25,context:60,supervisor-exit')).toHaveLength(6);
    for (const spec of ['stalled:0', 'stalled:-1', 'stalled:NaN', 'stalled:', 'supervisor']) {
      expect(() => parseWait(spec)).toThrow();
    }
    expect(matchWait(s.state, ['stalled:25'], [], s.state.seq, 1000 + 24 * 60000)).toBeNull();
    expect(matchWait(s.state, ['stalled:25'], [], s.state.seq, 1000 + 25 * 60000).type).toBe('stalled');
    s.lifecycle({ action: 'supervisor-started', runId: 'super' });
    expect(matchWait(s.state, ['supervisor-exit'])).toBeNull();
    s.lifecycle({ action: 'supervisor-ended', runId: 'super', code: 1 });
    expect(matchWait(s.state, ['supervisor-exit'], ['A'])).toMatchObject({ type: 'supervisor-exit', code: 1 });
  });
  it('driver emits no finished before fake pi exits and exposes the real nonzero exit', async () => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    const { server, store } = startBridge({ dir: join(dir, 'bridge'), port: 0 });
    await once(server, 'listening');
    try {
      const child = spawn('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({ PI_BRIDGE: '1',
        PI_LANE: 'A', PI_BRIDGE_PORT: String(server.address().port), PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'),
        FAKE_DELAY: '700', FAKE_TRACE: join(dir, 'trace') }), stdio: 'ignore' });
      children.push(child); const closed = once(child, 'close');
      await until(() => existsSync(join(dir, 'trace')));
      expect(matchWait(store.state, ['finished'])).toBeNull();
      expect((await closed)[0]).toBe(17);
      expect(matchWait(store.state, ['finished'])).toMatchObject({ lane: 'A', code: 17 });
    } finally { await new Promise<void>(done => server.close(done)); }
  });
});

describe('same-conversation fresh-output retry', () => {
  async function drive(patch: NodeJS.ProcessEnv = {}) {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    let code = 0;
    try { await exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({
      PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'), PI_MAX_ATTEMPTS: '3', PI_RETRY_BACKOFF: '0.01', ...patch }) });
    } catch (error: any) { code = error.code; }
    return { dir, out, code, history: json(out + '.d/driver.json') };
  }
  it.each(['429', '500', '502', '503', '504'])('forks last session on HTTP %s and preserves original artifacts', async status => {
    const { out, code, history } = await drive({ FAKE_ERROR: `HTTP ${status} unavailable` });
    expect(code).toBe(0); expect(history.attempts.map((a: any) => a.exit)).toEqual([17, 0]);
    expect(readFileSync(out, 'utf8')).toContain('attempt=2');
    expect(readFileSync(out + '.d/stderr.txt', 'utf8')).toContain(status);
    expect(readFileSync(out + '.attempt-2.d/stderr.txt', 'utf8')).toBe('');
  });
  it('does not reuse an old transient stderr to retry a permanent new failure', async () => {
    const { code, out, history } = await drive({ FAKE_FAILURES: '3', FAKE_NEXT_ERROR: 'HTTP 401 invalid credentials' });
    expect(code).toBe(17); expect(history.attempts).toHaveLength(2);
    expect(existsSync(out + '.attempt-3.d')).toBe(false);
  });
  it('bounds attempts and refuses overwriting an existing OUT.d', async () => {
    const { out, dir, code, history } = await drive({ FAKE_FAILURES: '99' });
    expect(code).toBe(17); expect(history.attempts).toHaveLength(3);
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, join(dir, 'brief'), out], { env: env() })).rejects.toThrow('refusing to overwrite');
    expect(json(out + '.d/driver.json')).toEqual(history);
  });
  it('never consumes a pre-existing retry OUT as new error evidence', async () => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    mkdirSync(out + '.attempt-2.d'); writeFileSync(out + '.attempt-2.d/stderr.txt', 'HTTP 503 stale');
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({
      PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'), PI_MAX_ATTEMPTS: '3', PI_RETRY_BACKOFF: '0' }) }))
      .rejects.toThrow('refusing to overwrite');
    expect(json(out + '.d/driver.json').attempts).toHaveLength(1);
    expect(readFileSync(out + '.attempt-2.d/stderr.txt', 'utf8')).toBe('HTTP 503 stale');
    expect(existsSync(out + '.attempt-3.d')).toBe(false);
  });
  it('never retries a timeout and kills its process group', async () => {
    const { code, out, history } = await drive({ FAKE_DELAY: '5000', PI_TIMEOUT: '0.2', FAKE_EARLY_ERROR: 'HTTP 503 timeout' });
    expect(code).toBe(124); expect(history.attempts).toHaveLength(1);
    expect(existsSync(out + '.attempt-2.d')).toBe(false);
  });
  it.each([['TERM', 143], ['KILL', 137]])('reports real pi signal death %s as %s', async (signal, expected) => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    const pi = script(join(dir, 'pi'), `kill -${signal} $$`);
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({ PI_BIN: pi }) }))
      .rejects.toMatchObject({ code: expected });
    expect(json(out + '.d/driver.json').exit).toBe(expected);
    expect(json(out + '.d/run.json').exit).toBe(expected);
  });
  it.each(['out', 'out.attempt-2'])('refuses an existing answer-only path %s', async name => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    const collision = join(dir, name); writeFileSync(collision, 'KEEP');
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({
      PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'), PI_MAX_ATTEMPTS: '3', PI_RETRY_BACKOFF: '0' }) }))
      .rejects.toThrow('refusing to overwrite');
    expect(readFileSync(collision, 'utf8')).toBe('KEEP');
    expect(existsSync(out + '.attempt-3.d')).toBe(false);
  });
  it('cancels during backoff without starting another attempt', async () => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    const child = spawn('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({
      PI_BIN: resolve('tests/fixtures/pi/retry-pi.mjs'), PI_MAX_ATTEMPTS: '3', PI_RETRY_BACKOFF: '30' }), stdio: 'ignore' });
    children.push(child); const closed = once(child, 'close');
    await until(() => existsSync(out + '.d/retry.md'));
    child.kill('SIGTERM'); expect((await closed)[0]).toBe(143);
    expect(json(out + '.d/driver.json').exit).toBe(143);
    expect(existsSync(out + '.attempt-2.d')).toBe(false);
  });
  it('does not restart a task when a provider failure left no session', async () => {
    const dir = temp(), prompt = join(dir, 'brief'), out = join(dir, 'out'); writeFileSync(prompt, 'task');
    const pi = script(join(dir, 'pi'), 'echo "HTTP 503 unavailable" >&2; exit 7');
    await expect(exec('bash', [join(here, 'run-pi.sh'), dir, prompt, out], { env: env({ PI_BIN: pi,
      PI_MAX_ATTEMPTS: '3', PI_RETRY_BACKOFF: '0' }) })).rejects.toMatchObject({ code: 7 });
    expect(json(out + '.d/driver.json').attempts).toHaveLength(1);
  });
});

async function sourceFixture() {
  const dir = temp(), source = join(dir, 'source'); mkdirSync(source);
  const git = (...a: string[]) => exec('git', ['-C', source, ...a]);
  await git('init', '-q', '-b', 'target'); writeFileSync(join(source, 'file'), 'base'); await git('add', '.');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  return { dir, source, git };
}
async function supervisorFixture(patch: NodeJS.ProcessEnv = {}, driverText?: string, lanes = ['A', 'B']) {
  const fixture = await sourceFixture(); const { dir, source } = fixture;
  const reservation = startBridge({ dir: join(dir, 'reservation'), port: 0 }); await once(reservation.server, 'listening');
  const port = String(reservation.server.address().port); await new Promise<void>(done => reservation.server.close(done));
  const brief = join(dir, 'brief'); writeFileSync(brief, 'TASK');
  const queue = join(dir, 'queue');
  writeFileSync(queue, lanes.map((lane, i) => `${lane}|${dir}/lane-${lane}|${dir}/scratch-${lane}|${5401 + i}|${brief}`).join('\n'));
  const seed = join(dir, 'seed'); mkdirSync(seed);
  writeFileSync(join(seed, 'auth.json'), JSON.stringify({ cpa: { key: 'fixture' }, other: { key: 'do-not-copy' } }));
  writeFileSync(join(seed, 'models.json'), JSON.stringify({ providers: { cpa: { models: [] }, other: {} } }));
  writeFileSync(join(seed, 'settings.json'), '{"packages":["do-not-copy"]}');
  const driver = script(join(dir, 'driver'), driverText ?? 'sleep 0.2; printf "%s\\n" "$PI_LANE" > "$3"');
  const run = join(dir, 'run');
  const child = spawn('bash', [join(here, 'supervise.sh'), source, 'HEAD', run, queue], { env: env({ PI_BRIDGE_PORT: port,
    PI_LANES_DRIVER: driver, PI_LANES_SANDBOX: '0', PI_LANES_AGENT_SEED: seed, PI_LANES_POLL: '1',
    PI_LANES_MAX: '1', PI_LANES_MIN_FREE_KB: '1', ...patch }), stdio: 'ignore' });
  children.push(child);
  const completion = once(child, 'close');
  return { ...fixture, run, child, completion, queue, port };
}
const stopBridge = (run: string) => {
  try { process.kill(Number(readFileSync(join(run, 'bridge.pid'), 'utf8')), 'SIGTERM'); } catch { /* not started */ }
};
describe('queued lane supervisor', () => {
  it('lazily clones at base, composes briefs, seeds only cpa, records results and exit event', async () => {
    const f = await supervisorFixture({}, 'sleep 1; printf "%s\\n" "$PI_LANE" > "$3"');
    try {
      await until(() => existsSync(join(f.run, 'supervisor.log')) && readFileSync(join(f.run, 'supervisor.log'), 'utf8').includes('A started'));
      expect(existsSync(join(f.dir, 'lane-B'))).toBe(false);
      expect((await f.completion)[0]).toBe(0);
      for (const lane of ['A', 'B']) {
        expect(json(join(f.run, `results/${lane}.json`))).toEqual({ lane, exit: 0, reason: 'exited' });
        expect((await exec('git', ['-C', join(f.dir, `lane-${lane}`), 'remote'])).stdout).toBe('');
        expect(json(join(f.dir, `scratch-${lane}/pi-agent/auth.json`))).toEqual({ cpa: { key: 'fixture' } });
        expect(Object.keys(json(join(f.dir, `scratch-${lane}/pi-agent/models.json`)).providers)).toEqual(['cpa']);
        expect(json(join(f.dir, `scratch-${lane}/pi-agent/settings.json`)).packages).toBeUndefined();
        expect(readFileSync(join(f.dir, `scratch-${lane}/brief.md`), 'utf8')).toContain('TASK');
      }
      expect(json(join(f.run, 'bridge/bridge-state.json')).supervisor.code).toBe(0);
    } finally { stopBridge(f.run); }
  });
  it('allows two concurrent lanes but not more than the configured maximum', async () => {
    const f = await supervisorFixture({ PI_LANES_MAX: '2' }, 'touch "$BGT_TRIAL_SCRATCH/started"; sleep 2', ['A', 'B', 'C']);
    try {
      await until(() => existsSync(join(f.dir, 'scratch-A/started')) && existsSync(join(f.dir, 'scratch-B/started')));
      expect(existsSync(join(f.run, 'results/A.json'))).toBe(false);
      expect(existsSync(join(f.dir, 'lane-C'))).toBe(false);
      expect((await f.completion)[0]).toBe(0);
      expect(json(join(f.run, 'results/C.json')).exit).toBe(0);
    } finally { stopBridge(f.run); }
  });
  it('disk guard fails closed before clone creation and emits every final result', async () => {
    const f = await supervisorFixture({ PI_LANES_MIN_FREE_KB: '999999999999' });
    try {
      expect((await f.completion)[0]).toBe(1);
      expect(existsSync(join(f.dir, 'lane-A'))).toBe(false);
      for (const lane of ['A', 'B']) expect(json(join(f.run, `results/${lane}.json`))).toMatchObject({ exit: 73, reason: 'disk' });
    } finally { stopBridge(f.run); }
  });
  it('disk guard stops running process groups and leaves queued clones uncreated', async () => {
    const bin = temp(), marker = join(bin, 'low');
    script(join(bin, 'df'), 'if [ -e "$FAKE_DISK_MARKER" ]; then echo "disk 100 100 0 100% /"; else /bin/df "$@"; fi');
    const f = await supervisorFixture({ PATH: bin + ':' + process.env.PATH, FAKE_DISK_MARKER: marker },
      'sleep 30 &\nPID=$!; echo "$PID" > "$BGT_TRIAL_SCRATCH/descendant"; touch "$FAKE_DISK_MARKER"; wait "$PID"');
    try {
      expect((await f.completion)[0]).toBe(1);
      const pid = Number(readFileSync(join(f.dir, 'scratch-A/descendant'), 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(existsSync(join(f.dir, 'lane-B'))).toBe(false);
      expect(json(join(f.run, 'results/A.json'))).toMatchObject({ exit: 73, reason: 'disk' });
    } finally { stopBridge(f.run); }
  });
  it('rejects duplicate/overlapping lane paths before starting a bridge', async () => {
    const { dir, source } = await sourceFixture(); const brief = join(dir, 'brief'); writeFileSync(brief, 'task');
    const queue = join(dir, 'queue'); writeFileSync(queue, `A|${dir}/lane|${dir}/lane/scratch|5401|${brief}`);
    await expect(exec('bash', [join(here, 'supervise.sh'), source, 'HEAD', join(dir, 'run'), queue], { env: env() })).rejects.toThrow('overlapping');
    expect(existsSync(join(dir, 'run/bridge.pid'))).toBe(false);
  });
});

describe('machine-wide heavy gate', () => {
  it('fails closed when the exit marker cannot be written, never retries a real command', async () => {
    const dir = temp(), trace = join(dir, 'calls');
    const real = script(join(dir, 'real'), `echo called >> "${trace}"; exit 75`);
    await expect(exec('bash', [join(here, 'shim/heavy.sh'), '--execute', join(dir, 'missing/result'), real]))
      .rejects.toMatchObject({ code: 74 });
    expect(readFileSync(trace, 'utf8')).toBe('called\n');
  });
  it('serializes heavy npm/npx, nested calls pass through, and real exit 75 is never retried', async () => {
    const dir = mkdtempSync(process.platform === 'darwin' ? '/private/tmp/bgt-gate-test-' : '/tmp/bgt-gate-test-'); dirs.push(dir);
    const real = script(join(dir, 'real'), `
case "$*" in *nested*) echo nested; exit 0;; esac
mkdir "$HEAVY_TEST_DIR/held" || exit 99
trap 'rmdir "$HEAVY_TEST_DIR/held"' EXIT
npm run nested-test
sleep 0.2
exit 75`);
    const e = env({ PATH: join(here, 'shim') + ':' + process.env.PATH, BGT_REAL_NPM: real, BGT_REAL_NPX: real,
      BGT_HEAVY_SLOTS: '1', BGT_HEAVY_HELD: '', BGT_HEAVY_LOCK_PREFIX: join(dir, 'gate'), HEAVY_TEST_DIR: dir });
    // LANE-K6e: matching is now by parsed subcommand/executable, so npx needs a genuinely heavy executable (`npx run test` is not one)
    const run = async (name: string) => { try { await exec(join(here, `shim/${name}`), name === 'npx' ? ['vitest', 'run'] : ['run', 'test'], { env: e, timeout: 3000 }); return 0;
    } catch (error: any) { return error.code; } };
    expect(await Promise.all([run('npm'), run('npx'), run('npm')])).toEqual([75, 75, 75]);
    expect(existsSync(join(dir, 'held'))).toBe(false);
  });
  it('passes lightweight commands without setting held and validates slot counts for heavy commands', async () => {
    const dir = temp(), real = script(join(dir, 'real'), 'printf "%s" "${BGT_HEAVY_HELD:-not-held}"');
    const e = env({ BGT_REAL_NPM: real, BGT_HEAVY_SLOTS: '0', BGT_HEAVY_HELD: '' });
    expect((await exec(join(here, 'shim/npm'), ['--version'], { env: e })).stdout).toBe('not-held');
    await expect(exec(join(here, 'shim/npm'), ['test'], { env: e })).rejects.toThrow('invalid BGT_HEAVY_SLOTS');
  });
});

describe('heavy gate FIFO and matching (LANE-K6e)', () => {
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const gateDir = () => { const dir = mkdtempSync(process.platform === 'darwin' ? '/private/tmp/bgt-gate-test-' : '/tmp/bgt-gate-test-'); dirs.push(dir); return dir; };
  const gateEnv = (dir: string, real: string, patch: NodeJS.ProcessEnv = {}) => env({ BGT_REAL_NPM: real, BGT_REAL_NPX: real,
    BGT_HEAVY_SLOTS: '1', BGT_HEAVY_HELD: '', BGT_HEAVY_LOCK_PREFIX: join(dir, 'gate'), HEAVY_TEST_DIR: dir, ...patch });
  const launch = (dir: string, real: string, name: string, tag: string, patch: NodeJS.ProcessEnv = {}) => {
    const child = spawn(join(here, 'shim/npm'), ['run', 'test', tag], { env: gateEnv(dir, real, patch), stdio: 'ignore' });
    children.push(child);
    return once(child, 'close').then(([code]) => ({ name, code, child }));
  };
  const holdScript = (dir: string, hold: string) => script(join(dir, 'real'), `echo "$3" >> "$HEAVY_TEST_DIR/trace"; sleep ${hold}; echo "end $3" >> "$HEAVY_TEST_DIR/trace"`);
  const trace = (dir: string) => readFileSync(join(dir, 'trace'), 'utf8').trim().split('\n');
  const classify = async (tool: string, args: string[]) => (await exec(join(here, `shim/${tool}`), args,
    { env: env({ BGT_HEAVY_CLASSIFY: '1', BGT_REAL_NPM: '/bin/echo', BGT_REAL_NPX: '/bin/echo' }) })).stdout.trim();

  it('classifies by subcommand, script and executable, not by substrings of arbitrary arguments', async () => {
    const heavy: [string, string[]][] = [['npm', ['test']], ['npm', ['t']], ['npm', ['run', 'test:e2e']], ['npm', ['run', '--silent', 'build:port']],
      ['npm', ['--prefix', 'x', 'run', 'oracle', '--', 'port', '300']], ['npm', ['run', '-w', 'pkg', 'test']], ['npm', ['run', 'lint']], ['npm', ['run', 'bench']],
      ['npm', ['run', 'probe', '--', 'x']], ['npm', ['exec', '--', 'playwright', 'test']], ['npm', ['exec', '--yes', 'vitest', 'run']],
      ['npx', ['playwright', 'test']], ['npx', ['-y', 'vitest', 'run']], ['npx', ['-p', 'pkg', 'eslint', '.']]];
    const light: [string, string[]][] = [['npm', ['install', 'vitest']], ['npm', ['view', '@playwright/test', 'version']], ['npm', ['run', 'typecheck']],
      ['npm', ['pkg', 'get', 'scripts.test']], ['npm', ['ls']], ['npm', ['--version']], ['npm', ['run', 'docs', '--', 'build']], ['npm', ['run', 'buildinfo']],
      ['npm', ['run', 'dev', '--', '--host', 'testing']], ['npm', ['config', 'get', 'cache']], ['npx', ['tsc', '-p', '.']], ['npx', ['cowsay', 'test']], ['npm', []]];
    for (const [tool, args] of heavy) expect(await classify(tool, args), `${tool} ${args.join(' ')}`).toBe('heavy');
    for (const [tool, args] of light) expect(await classify(tool, args), `${tool} ${args.join(' ')}`).toBe('light');
  });

  it('serves waiters strictly oldest first and never overlaps beyond the slot count', async () => {
    const dir = gateDir(), real = holdScript(dir, '0.35');
    const runs = [];
    for (const tag of ['a', 'b', 'c', 'd', 'e']) { runs.push(launch(dir, real, tag, tag)); await sleep(120); }
    expect((await Promise.all(runs)).map(r => r.code)).toEqual([0, 0, 0, 0, 0]);
    expect(trace(dir)).toEqual(['a', 'end a', 'b', 'end b', 'c', 'end c', 'd', 'end d', 'e', 'end e']);
    expect(existsSync(join(dir, 'gate-queue')) ? readdirSync(join(dir, 'gate-queue')) : []).toEqual([]);
  });

  it('drops tickets of dead waiters and of reused pids, but a live older ticket still blocks until removed', async () => {
    const dir = gateDir(), real = holdScript(dir, '0.1'), queue = join(dir, 'gate-queue');
    mkdirSync(queue);
    const dead = spawn('true'); await once(dead, 'close');
    writeFileSync(join(queue, `0000000001.000000-${dead.pid}`), '');
    writeFileSync(join(queue, `0000000002.000000-${process.pid}`), 'Thu Jan  1 00:00:00 1970'); // live pid, different start time = reuse
    await expect(launch(dir, real, 'x', 'x').then(r => r.code)).resolves.toBe(0);
    expect(trace(dir)).toEqual(['x', 'end x']);
    expect(readdirSync(queue)).toEqual([]);
    // a genuinely live older waiter keeps its place
    // LANE-K7i: use kernel incarnation identity; ps is denied in the kit sandbox.
    const { stdout } = await exec('python3', ['-I', join(here, 'process-start.py'), String(process.pid)]);
    const live = join(queue, `0000000003.000000-${process.pid}`);
    writeFileSync(live, stdout.trim());
    const blocked = launch(dir, real, 'y', 'y');
    await sleep(900);
    expect(existsSync(join(dir, 'trace')) ? trace(dir).includes('y') : false).toBe(false);
    rmSync(live);
    expect((await blocked).code).toBe(0);
    expect(trace(dir)).toContain('y');
  });

  it('re-reads the slot count every loop, so a waiter starts when the operator raises it', async () => {
    const dir = gateDir(), real = holdScript(dir, '2.5'), slotsFile = join(dir, 'gate-slots');
    writeFileSync(slotsFile, '1\n');
    const first = launch(dir, real, 'a', 'a'); await sleep(500);
    const second = launch(dir, real, 'b', 'b'); await sleep(700);
    expect(trace(dir)).toEqual(['a']); // b waits behind the single slot
    writeFileSync(slotsFile, '2\n');
    await until(() => trace(dir).includes('b'));
    expect(trace(dir)).not.toContain('end a'); // b started while a was still running
    expect([(await first).code, (await second).code]).toEqual([0, 0]);
    writeFileSync(slotsFile, '0\n');
    await expect(exec(join(here, 'shim/npm'), ['test'], { env: gateEnv(dir, real) })).rejects.toThrow('invalid BGT_HEAVY_SLOTS');
  });

  it('removes its ticket when terminated while waiting', async () => {
    const dir = gateDir(), real = holdScript(dir, '1.5'), queue = join(dir, 'gate-queue');
    const holder = launch(dir, real, 'a', 'a'); await sleep(400);
    const waiter = launch(dir, real, 'w', 'w'); await sleep(400);
    expect(readdirSync(queue)).toHaveLength(1);
    for (const child of children) if (child.spawnargs.includes('w')) child.kill('SIGTERM');
    expect((await waiter).code).toBe(143);
    expect(readdirSync(queue)).toEqual([]);
    expect((await holder).code).toBe(0);
    expect(trace(dir)).not.toContain('w');
  });
});

describe('verified lane cleanup', () => {
  it('refuses an external git-dir worktree', async () => {
    const { dir, source, git } = await sourceFixture(); const lane = join(dir, 'worktree');
    await git('worktree', 'add', '-q', '-b', 'lane', lane);
    await expect(exec('bash', [join(here, 'cleanup.sh'), lane, source, 'target'])).rejects.toThrow('not an independent clone');
    expect(existsSync(lane)).toBe(true);
  });
  it('refuses dirty submodule content', async () => {
    const { dir, source, git } = await sourceFixture(); const lane = join(dir, 'lane');
    const sub = await sourceFixture();
    await git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.source, 'sub');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qam', 'submodule');
    await exec('git', ['clone', '-q', '--no-hardlinks', source, lane]);
    await exec('git', ['-C', lane, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q']);
    writeFileSync(join(lane, 'sub/untracked'), 'unsafe');
    await expect(exec('bash', [join(here, 'cleanup.sh'), lane, source, 'target'])).rejects.toThrow('dirty');
    expect(existsSync(lane)).toBe(true);
  });
  it('refuses dirty/unmerged clones, accepts only HEAD contained in a target branch', async () => {
    const { dir, source, git } = await sourceFixture(); const lane = join(dir, 'lane');
    await exec('git', ['clone', '-q', '--no-hardlinks', source, lane]);
    writeFileSync(join(lane, 'untracked'), 'unsafe');
    await expect(exec('bash', [join(here, 'cleanup.sh'), lane, source, 'target'])).rejects.toThrow('dirty');
    rmSync(join(lane, 'untracked'));
    await exec('git', ['-C', lane, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'lane']);
    await expect(exec('bash', [join(here, 'cleanup.sh'), lane, source, 'target'])).rejects.toThrow('not contained');
    expect(existsSync(lane)).toBe(true);
    await git('fetch', '-q', lane, 'HEAD'); await git('merge', '--ff-only', 'FETCH_HEAD');
    await exec('bash', [join(here, 'cleanup.sh'), lane, source, 'target']); expect(existsSync(lane)).toBe(false);
  });
});
