#!/usr/bin/env python3
"""Measured parallel object compilation; atomic content-cache publication on macOS/Linux.
Object identities/dependencies are supplied by the caller. Per-key kernel locks coordinate
writers across clones; no reader can see a partial object. Never execute guest programs.
"""
import concurrent.futures
import fcntl
import glob
import hashlib
import json
import os
import resource
import subprocess
import sys
import time
import uuid


def command(args, pass_fds=(), stdout_path=None):
    start = time.monotonic()
    if stdout_path:
        with open(stdout_path, 'w') as output:
            subprocess.run(args, check=True, stdout=output, pass_fds=pass_fds)
    else:
        subprocess.run(args, check=True, stdout=sys.stderr, pass_fds=pass_fds)
    return round((time.monotonic() - start) * 1000, 3)


def main():
    cfg = json.load(sys.stdin)
    jobs = max(1, min(8, int(cfg.get('jobs', 2))))

    def compile_one(o):
        if os.path.exists(o['out']) and (not o.get('stdout') or os.path.exists(o['stdout'])):
            return None  # Immutable published payload; caller's lease pins it through linking.
        # Lock files have permanent inodes, live outside the payload/LRU namespace.
        locks = os.path.join(os.path.dirname(o['out']), '.locks')
        os.makedirs(locks, exist_ok=True)
        # A bounded set of stripes avoids one permanent inode per obsolete key.
        stripe = hashlib.sha256(os.fsencode(os.path.basename(o['out']))).digest()[0]
        with open(os.path.join(locks, '%02x.lock' % stripe), 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # The child retains the lock if its Python supervisor is interrupted.
            # Once acquired, abandoned temporaries for this key are safe to remove.
            for abandoned in glob.glob(o['out'] + '.*.tmp') + glob.glob(o['out'] + '.*.tmp.stdout'):
                os.unlink(abandoned)
            if os.path.exists(o['out']) and (not o.get('stdout') or os.path.exists(o['stdout'])):
                return None
            temp = o['out'] + '.' + uuid.uuid4().hex + '.tmp'
            try:
                elapsed = command(o['args'] + ['-o', temp], (lock.fileno(),), temp+'.stdout' if o.get('stdout') else None)
                if o.get('stdout'):
                    os.replace(temp+'.stdout', o['stdout'])
                os.replace(temp, o['out'])
                return {'object': o['out'], 'compile_ms': elapsed}
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
                if os.path.exists(temp+'.stdout'):
                    os.unlink(temp+'.stdout')

    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        timings = [t for t in pool.map(compile_one, cfg.get('objects', [])) if t is not None]
    compile_ms = round((time.monotonic()-start)*1000, 3)
    link_ms = command(cfg['link']) if cfg.get('link') else 0
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    peak = int(rss if sys.platform == 'darwin' else rss * 1024)
    print(json.dumps({'duration_ms': round((time.monotonic()-start)*1000, 3), 'peak_child_rss_bytes': peak,
                      'compile_ms': compile_ms, 'link_ms': link_ms, 'object_timings': timings,
                      'parallel_rss_upper_bound_bytes': peak * jobs,
                      'objects_compiled': len(timings), 'objects_cached': len(cfg.get('objects', []))-len(timings), 'jobs': jobs}))


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, ValueError, OSError) as e:
        sys.exit('compile: %s' % e)
