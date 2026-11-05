// @bgt-examples: none
import { it, expect, vi } from 'vitest';
import { execFileSync as nativeExec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
// @ts-expect-error ESM build tool
import { execFileSync, withBuildWriters } from '../../tools/build/exec.mjs';
// @ts-expect-error ESM host tool discovery
import { findGcc } from '../../tools/build/check-host-gcc.mjs';

const transport = new URL('../../tools/build/exec.mjs', import.meta.url).href;
const compile = join(ROOT, 'tools/build/compile.py');
const lift = join(ROOT, 'tools/build/lift.py');
const options = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

it('supplies finite anonymous regular-file stdin, including large binary and Unicode inputs', () => {
  const script = 'import os,sys,stat,hashlib,json; s=os.fstat(0); b=sys.stdin.buffer.read(); print(json.dumps([stat.S_ISREG(s.st_mode),s.st_nlink,len(b),hashlib.sha256(b).hexdigest()]))';
  const data = Buffer.from('α😀\0'.repeat(300_000));
  const expected = createHash('sha256').update(data).digest('hex');
  for (const stdio of [undefined, 'pipe', ['pipe', 'pipe', 'pipe']]) {
    const result = JSON.parse(execFileSync('python3', ['-I', '-c', script], { input: data, encoding: 'utf8', stdio }));
    expect(result).toEqual([true, 0, data.length, expected]);
  }
});

it('compile and lift share the transport, with and without a writer lease', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-transport-test-')), token = join(dir, 'lease');
  writeFileSync(token, ''); writeFileSync(token + '.writers', '');
  try {
    for (const helper of [compile, lift]) for (const lease of [null, token]) {
      const result = JSON.parse(withBuildWriters(lease, () => execFileSync('python3', ['-I', helper], {
        ...options, input: JSON.stringify({ objects: [], tasks: [], jobs: 1, padding: 'λ'.repeat(300_000) }),
      })));
      expect(result.jobs ?? result.lift_jobs).toBe(1);
      expect(result.objects_compiled ?? result.chunks_lifted).toBe(0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('moves oversized Node argv through a file after the OS spawn boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-argv-boundary-'));
  const script = join(dir, 'argv-probe.mjs');
  const value = 'α😀 quote'.repeat(25000); // over Linux MAX_ARG_STRLEN
  writeFileSync(script, "import {writeFileSync} from 'node:fs'; const a=process.argv.slice(2), out=a.at(-1); writeFileSync(out, 'ok'); console.log(JSON.stringify({max:Math.max(...a.map(x=>Buffer.byteLength(x)),0),value:a[0],quote:a[1]}));\n");
  try {
    const result = JSON.parse(execFileSync('python3', ['-I', compile], { ...options, input: JSON.stringify({objects: [{out: join(dir, 'value.o'), stdout: join(dir, 'observed'), args: [process.execPath, script, value, 'λ "quoted"']}], jobs: 1}), encoding: 'utf8' }));
    const report = JSON.parse(readFileSync(join(dir, 'observed'), 'utf8'));
    expect(result.objects_compiled).toBe(1); expect(report.max).toBe(Buffer.byteLength(value)); expect(report.value).toBe(value); expect(report.quote).toBe('λ "quoted"');
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

it('bounds oversized lift argv on macOS as on Linux', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-lift-argv-boundary-'));
  const launcher = join(dir, 'node');
  const script = join(dir, 'lift-probe.mjs');
  const out = join(dir, 'lift.c');
  const observed = join(dir, 'observed.json');
  const value = 'α😀 quote'.repeat(25000);
  writeFileSync(launcher, '#!/usr/bin/env python3\nimport os,sys\nif any(len(os.fsencode(a))+1 > 131072 for a in sys.argv): sys.exit(91)\nos.execv(' + JSON.stringify(process.execPath) + ', sys.argv)\n');
  chmodSync(launcher, 0o700);
  writeFileSync(script, "import {writeFileSync} from 'node:fs'; const a=process.argv.slice(2), i=a.indexOf('--out'), out=a[i+1]; writeFileSync(out, 'int lifted(void){return 23;}\\n'); writeFileSync(out+'.stats.json', JSON.stringify({analysis_cpu_ms:1,c_generation_cpu_ms:2})); writeFileSync(a[2], JSON.stringify({value:a[0],quote:a[1]}));");
  try {
    const result = JSON.parse(execFileSync('python3', ['-I', lift], { ...options, input: JSON.stringify({tasks: [{out, key: 'lift-key', args: [launcher, script, value, 'λ "quoted"', observed]}], jobs: 1}), encoding: 'utf8' }));
    expect(result.chunks_lifted).toBe(1);
    expect(JSON.parse(readFileSync(observed, 'utf8'))).toEqual({value, quote: 'λ "quoted"'});
    expect(readFileSync(out, 'utf8')).toContain('return 23');
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

it('moves oversized compiler argv through a response file with exact quoting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-rsp-boundary-')); const source = join(dir, 'value.c'); const out = join(dir, 'value.o');
  writeFileSync(source, '#if BGT_PADDING_21999 != 21999 || BGT_DEFAULT != 1 || BGT_FUNCTION(7) != 1 || BGT_ORDER != 23\n#error padding macro semantics were lost\n#endif\n#ifdef BGT_UNDEFINED\n#error undef order was lost\n#endif\nconst char *quoted = BGT_QUOTED;\nint value(void){return quoted[0] ? 23 : 0;}\n');
  const padding = Array.from({length: 22000}, (_, i) => '-DBGT_PADDING_'+i+'='+i).concat([
    '-DBGT_QUOTED="λ😀"', '-DBGT_DEFAULT', '-D', 'BGT_FUNCTION(x)',
    '-DBGT_ORDER=17', '-U', 'BGT_ORDER', '-D', 'BGT_ORDER=23', '-DBGT_UNDEFINED', '-UBGT_UNDEFINED',
  ]);
  try {
    // macOS's cc is Apple clang; exercise installed real GCC as well, matching Linux's cc1 boundary.
    for (const cc of new Set(['cc', findGcc()].filter(Boolean))) {
      rmSync(out, {force:true});
      const result = JSON.parse(execFileSync('python3', ['-I', compile], { ...options, input: JSON.stringify({objects: [{out, args: [cc, '-std=c11', '-Wall', '-Wextra', '-Werror', '-c', source, ...padding]}], jobs: 1}), encoding: 'utf8' }));
      expect(result.objects_compiled).toBe(1); expect(readFileSync(out).length).toBeGreaterThan(0);
    }
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

it('rejects oversized argv strings, environment strings and aggregate budgets before spawning', () => {
  const script = `import os,runpy
check=runpy.run_path(${JSON.stringify(join(ROOT, 'tools/build/command.py'))})['check_budget']
check(['node','x'*131071],{})
for args,env in [(['node','x'*131072],{}),(['node'],{'LARGE':'x'*131072}),(['node']+['x'*16384]*64,{})]:
 try:check(args,env)
 except ValueError as e:assert 'portable Linux budget' in str(e)
 else:raise AssertionError('oversized child plan accepted')
print('budgets enforced')`;
  expect(nativeExec('python3', ['-I', '-c', script], {encoding:'utf8',timeout:5000})).toContain('budgets enforced');
});

it('reproduces withheld socket EOF deterministically, then bypasses it with finite stdin', () => {
  // All JSON bytes are present; an open peer prevents json.load's unbounded read.
  // Models unavailable EOF, not the exact observed macOS half-close/wakeup race.
  const source = `import {execFileSync} from ${JSON.stringify(transport)};console.log(execFileSync('python3',['-I',${JSON.stringify(compile)}],{input:JSON.stringify({objects:[],jobs:1}),encoding:'utf8',stdio:[0,'pipe','pipe']}));`;
  const script = `import json,socket,subprocess
a,b=socket.socketpair();a.sendall(b'{"objects":[],"jobs":1}')
p=subprocess.Popen(['python3','-I',${JSON.stringify(compile)}],stdin=b,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 try:p.communicate(timeout=.25)
 except subprocess.TimeoutExpired:pass
 else:raise AssertionError('EOF reproducer did not block')
finally:p.kill();p.communicate()
r=subprocess.run([${JSON.stringify(process.execPath)},'--input-type=module','-e',${JSON.stringify(source)}],stdin=b,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
assert r.returncode==0,r.stderr
assert json.loads(r.stdout)['objects_compiled']==0
print('old=blocked fixed=passed')`;
  expect(nativeExec('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 10000 })).toContain('old=blocked fixed=passed');
});

function assertGone(pids: number[]) {
  const script = `import os,sys,time
for _ in range(200):
 alive=[]
 for p in map(int,sys.argv[1:]):
  try:os.kill(p,0);alive.append(p)
  except ProcessLookupError:pass
 if not alive:break
 time.sleep(.01)
else:raise AssertionError('orphan helpers: %s'%alive)`;
  nativeExec('python3', ['-I', '-c', script, ...pids.map(String)], { timeout: 5000 });
}

it('times out the entire helper tree with helper, argv and phase diagnostics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-timeout-test-')), marker = join(dir, 'pids');
  const grandchild = 'import time;time.sleep(100)';
  const child = `import os,subprocess,time,json,signal
signal.signal(signal.SIGTERM,signal.SIG_IGN)
p=subprocess.Popen(['python3','-I','-c',${JSON.stringify(grandchild)}])
open(${JSON.stringify(marker)},'w').write(json.dumps([os.getpid(),p.pid]))
time.sleep(100)`;
  try {
    expect(() => execFileSync('python3', ['-I', compile], {
      ...options, timeout: 1500, phase: 'compile/link regression',
      input: JSON.stringify({ objects: [{ out: join(dir, 'value.o'), args: ['python3', '-I', '-c', child] }], jobs: 1 }),
    })).toThrow(/phase=compile\/link regression.*timeout=1500ms.*compile.py/);
    expect(existsSync(marker)).toBe(true);
    assertGone(JSON.parse(readFileSync(marker, 'utf8')));
    expect(readdirSync(dir).filter((p) => p.endsWith('.tmp'))).toEqual([]);
    // Killed writers release inherited object locks: a real compiler can retry.
    const source = join(dir, 'value.c');
    writeFileSync(source, 'int value(void){return 23;}\n');
    const result = JSON.parse(execFileSync('python3', ['-I', compile], { ...options, input: JSON.stringify({
      objects: [{ out: join(dir, 'value.o'), args: ['cc', '-c', source] }], jobs: 1,
    }) }));
    expect(result.objects_compiled).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 10000);

it('kills leftover children on helper failure and output-buffer failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-failure-test-')), marker = join(dir, 'pids');
  try {
    for (const mode of ['exit', 'overflow', 'stopped-supervisor']) {
      const script = `import os,signal,subprocess,json,sys,time
p=subprocess.Popen(['python3','-I','-c','import time;time.sleep(100)'])
open(${JSON.stringify(marker)},'w').write(json.dumps([p.pid]))
${mode === 'overflow' ? "sys.stdout.write('x'*100000);sys.stdout.flush();time.sleep(100)" : mode === 'exit' ? "sys.exit(3)" : "os.kill(os.getppid(),signal.SIGSTOP);time.sleep(100)"}`;
      expect(() => execFileSync('python3', ['-I', '-c', script], {
        ...options, maxBuffer: 1024, timeout: 1000, phase: 'failure regression',
      })).toThrow(/build helper failed: phase=failure regression/);
      assertGone(JSON.parse(readFileSync(marker, 'utf8')));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 15000);

it('preserves the original helper failure when process-group cleanup throws EPERM', () => {
  const cleanupError = Object.assign(new Error('injected kill EPERM'), { code: 'EPERM' });
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw cleanupError; });
  let failure: Error & { pid?: number; signal?: string; cleanupErrors?: Error[] } | undefined;
  try {
    execFileSync('python3', ['-I', '-c', 'import sys;sys.exit(23)'], {
      ...options, phase: 'cleanup diagnostic regression', timeout: 2000,
    });
  } catch (error) { failure = error as typeof failure; }
  finally { kill.mockRestore(); }
  expect(failure).not.toBe(cleanupError);
  expect(failure?.message).toMatch(/build helper failed: phase=cleanup diagnostic regression.*argv=.*python3/);
  expect(failure?.message).toContain('sys.exit(23)');
  expect(failure?.message).toContain('cleanup failed: injected kill EPERM');
  expect(failure?.pid).toBeGreaterThan(0);
  expect(failure?.signal).toBe('SIGKILL');
  expect(failure?.cleanupErrors).toEqual([cleanupError]);
});

it('keeps independent lock-lifetime supervisors isolated from an ancestor group', () => {
  const script = `import {execFileSync} from ${JSON.stringify(transport)};
const group=execFileSync('python3',['-I','-c','import os;print(os.getpgrp())'],{
  independentGroup:true,encoding:'utf8',timeout:2000,phase:'independent guardian regression'
}).trim();
if(Number(group)===Number(process.env._BGT_BUILD_PROCESS_GROUP))throw new Error('guardian joined owner group');
console.log('isolated');`;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { ...options, timeout:5000 })).toContain('isolated');
});

// I13: compile.py -> asyncify.mjs -> Binaryen is a nested wrapper tree.

// Before containment, the inner detached group survives the ancestor's failure.
it.each(['ancestor deadline', 'ancestor output failure', 'nested deadline'])('owns nested helper groups after %s', (mode) => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-nested-timeout-')), marker = join(dir, 'pids');
  const cleanupErrors: unknown[] = [];
  const child = `import os,subprocess,json,sys,time
p=subprocess.Popen(['python3','-I','-c','import time;time.sleep(100)'])
open(${JSON.stringify(marker)},'w').write(json.dumps([os.getpid(),p.pid]))
${mode === 'ancestor output failure' ? "sys.stderr.write('x'*100000);sys.stderr.flush()" : ''}
time.sleep(100)`;
  const source = `import {execFileSync} from ${JSON.stringify(transport)};
execFileSync('python3',['-I','-c',${JSON.stringify(child)}],{
  stdio:['ignore','ignore','inherit'], timeout:${mode === 'nested deadline' ? 1500 : 10000}, phase:'Asyncify partition regression'
});`;
  try {
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      ...options, timeout: mode === 'nested deadline' ? 5000 : 2500,
      maxBuffer: mode === 'ancestor output failure' ? 1024 : 1048576, phase: 'outer wasm-opt regression',
    })).toThrow(/build helper failed: phase=outer wasm-opt regression/);
    expect(existsSync(marker)).toBe(true);
    assertGone(JSON.parse(readFileSync(marker, 'utf8')));
  } finally {
    // Also clean the expected-before failure so mutation proof leaves no sleepers.
    if (existsSync(marker)) for (const pid of JSON.parse(readFileSync(marker, 'utf8'))) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error); }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  expect(cleanupErrors).toEqual([]);
}, 15000);

it('cleans staged input on errors and refuses unbounded or invalid deadlines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-input-test-')), previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    expect(() => execFileSync('not-a-real-build-helper', [], { ...options, input: '{}' })).toThrow(/argv=.*not-a-real-build-helper/);
    expect(readdirSync(dir)).toEqual([]);
    for (const timeout of [0, -1, NaN, Infinity, 1.5])
      expect(() => execFileSync('python3', [], { timeout })).toThrow(/positive integer/);
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
