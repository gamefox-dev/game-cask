// @bgt-examples: none
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// @ts-expect-error ESM build tool
import { buildLock } from '../../tools/build/lock.mjs';
// @ts-expect-error ESM build tool
import { withBuildWriters } from '../../tools/build/exec.mjs';

const lock = new URL('../../tools/build/lock.mjs', import.meta.url).href;

it('bounds guardian readiness before and after watcher registration, without orphan helpers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-lock-transport-'));
  const python = execFileSync('python3', ['-I', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim();
  try {
    // Stop the real guardian, not a fake lock implementation. Its readiness pipe
    // stays open; the internal flock-wait timeout alone cannot bound this read.
    const wrapper = join(dir, 'stop.py');
    writeFileSync(wrapper, `import os,sys,signal,runpy,json
old_fork,old_write=os.fork,os.write
def stop():
 open(os.environ['MARKER'],'w').write(json.dumps([os.getppid(),os.getpid()]))
 os.kill(os.getpid(),signal.SIGSTOP)
def fork():
 p=old_fork()
 if p==0 and os.environ['STOP_AT']=='fork':stop()
 return p
def write(fd,data):
 if data==b'1' and os.environ['STOP_AT']=='ready':stop()
 return old_write(fd,data)
os.fork,os.write=fork,write
sys.argv=sys.argv[1:]
runpy.run_path(sys.argv[0],run_name='__main__')
`);
    writeFileSync(join(dir, 'python3'), `#!/bin/sh
if [ "$2" = ${JSON.stringify(new URL('../../tools/build/file-lock.py', import.meta.url).pathname)} ]; then
 shift
 exec ${JSON.stringify(python)} -I ${JSON.stringify(wrapper)} "$@"
fi
exec ${JSON.stringify(python)} "$@"
`);
    chmodSync(join(dir, 'python3'), 0o700);
    for (const stopAt of ['fork', 'ready']) {
      const marker = join(dir, 'pids-' + stopAt);
      const source = `import {buildLock} from ${JSON.stringify(lock)};buildLock(${JSON.stringify(dir)},'readiness',0.5);`;
      const script = `import os,json,signal,subprocess,time
p=subprocess.Popen([${JSON.stringify(process.execPath)},'--input-type=module','-e',${JSON.stringify(source)}],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 try:out,err=p.communicate(timeout=4)
 except subprocess.TimeoutExpired:raise AssertionError('unbounded guardian readiness')
 assert p.returncode!=0,(out,err)
 assert b'phase=lock acquisition/readiness' in err,err
 assert b'file-lock.py' in err and b'readiness.flock' in err,err
 pids=json.load(open(${JSON.stringify(marker)}))
 for _ in range(200):
  alive=[]
  for pid in pids:
   try:os.kill(pid,0);alive.append(pid)
   except ProcessLookupError:pass
  if not alive:break
  time.sleep(.01)
 else:raise AssertionError('orphan lock helpers: %s'%alive)
 print('bounded, diagnosed, no orphans')
finally:
 if os.path.exists(${JSON.stringify(marker)}):
  for pid in reversed(json.load(open(${JSON.stringify(marker)}))):
   try:os.kill(pid,signal.SIGKILL)
   except ProcessLookupError:pass
 if p.poll() is None:p.kill()
 p.communicate()
`;
      expect(execFileSync(python, ['-I', '-c', script], {
        encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: dir + ':' + process.env.PATH,
          BGT_BUILD_TIMEOUT_MS: '500', MARKER: marker, STOP_AT: stopAt },
      })).toContain('bounded, diagnosed, no orphans');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);

it('nested lock guardians do not retain an outer build writer lease', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-lock-writers-')), token = join(dir, 'outer');
  writeFileSync(token, ''); writeFileSync(token + '.writers', '');
  let release: (() => void) | undefined;
  try {
    release = withBuildWriters(token, () => buildLock(dir, 'nested', 2));
    // The guardian remains alive until release, but must not pin outer.writers.
    execFileSync('python3', ['-I', '-c',
      'import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)', token + '.writers'], { timeout: 2000 });
  } finally { release?.(); rmSync(dir, { recursive: true, force: true }); }
});
