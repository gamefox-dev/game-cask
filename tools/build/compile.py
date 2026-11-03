#!/usr/bin/env python3
"""Atomic content-cache writers, with inherited per-key kernel locks and memory-aware workers."""
import concurrent.futures
import fcntl
import glob
import hashlib
import json
import os
from pathlib import Path
import resource
import runpy
import subprocess
import sys
import time
import uuid


def command(args, pass_fds=(), stdout_path=None, cwd=None):
    start = time.monotonic()
    if stdout_path:
        with open(stdout_path, 'w') as output:
            subprocess.run(args, check=True, stdout=output, pass_fds=pass_fds, cwd=cwd)
    else:
        subprocess.run(args, check=True, stdout=sys.stderr, pass_fds=pass_fds, cwd=cwd)
    return round((time.monotonic() - start) * 1000, 3)


def main():
    cfg = json.load(sys.stdin)
    jobs, memory = runpy.run_path(str(Path(__file__).with_name('parallel.py')))['parallelism'](cfg.get('jobs'))

    def compile_one(o):
        def valid():
            return o.get('cacheable', True) and os.path.exists(o['out']) and (not o.get('stdout') or os.path.exists(o['stdout']))
        def hit():
            return {'object': o['out'], 'cache': 'hit', 'compile_ms': 0, 'miss_reasons': []}
        if valid():
            return hit()  # Immutable payload, pinned by caller's lease.
        locks = os.path.join(os.path.dirname(o['out']), '.locks')
        os.makedirs(locks, exist_ok=True)
        stripe = hashlib.sha256(os.fsencode(os.path.basename(o['out']))).digest()[0]
        with open(os.path.join(locks, '%02x.lock' % stripe), 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # Children inherit the lock even if Python is killed.
            for abandoned in glob.glob(o['out'] + '.*.tmp') + glob.glob(o['out'] + '.*.tmp.stdout'):
                os.unlink(abandoned)
            if valid():
                return hit()
            temp = o['out'] + '.' + uuid.uuid4().hex + '.tmp'
            try:
                elapsed = command(o['args'] + ['-o', temp], (lock.fileno(),), temp+'.stdout' if o.get('stdout') else None, o.get('cwd'))
                if o.get('stdout'):
                    os.replace(temp+'.stdout', o['stdout'])
                os.replace(temp, o['out'])
                return {'object': o['out'], 'cache': 'miss', 'compile_ms': elapsed,
                        'miss_reasons': o.get('miss_reasons') or [{'input': 'payload'}]}
            finally:
                for p in (temp, temp+'.stdout'):
                    if os.path.exists(p): os.unlink(p)

    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        decisions = list(pool.map(compile_one, cfg.get('objects', [])))
    compile_ms = round((time.monotonic() - start) * 1000, 3)
    timings = [d for d in decisions if d['cache'] == 'miss']
    link_ms = command(cfg['link']) if cfg.get('link') else 0
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    peak = int(rss if sys.platform == 'darwin' else rss * 1024)
    print(json.dumps({'duration_ms': round((time.monotonic()-start)*1000, 3), 'peak_child_rss_bytes': peak,
                      'compile_ms': compile_ms, 'link_ms': link_ms, 'object_timings': timings, 'memory': memory,
                      'object_cache_decisions': [{'source': o.get('source', o['out']), 'key': os.path.basename(o['out']),
                                                  'hit': d['cache'] == 'hit', 'reasons': d['miss_reasons']}
                                                 for o, d in zip(cfg.get('objects', []), decisions)],
                      'parallel_rss_upper_bound_bytes': peak * jobs,
                      'objects_uncacheable': sum(o.get('cacheable') is False for o in cfg.get('objects', [])),
                      'objects_compiled': len(timings), 'objects_cached': len(decisions)-len(timings), 'jobs': jobs}))


if __name__ == '__main__':
    try: main()
    except (subprocess.CalledProcessError, ValueError, OSError) as e: sys.exit('compile: %s' % e)
