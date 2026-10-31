#!/usr/bin/env python3
"""Bounded parallel invocation of the existing lifter's --select contract.
Publication marker is written last; interrupted jobs are never cache hits.
"""
import concurrent.futures
import json
import os
import resource
import subprocess
import sys
import time


def main():
    cfg = json.load(sys.stdin)
    jobs = max(1, min(8, int(cfg.get('jobs', 2))))
    tasks = cfg['tasks']
    def valid(t):
        try:
            with open(t['out'] + '.key') as f:
                return f.read() == t['key'] and os.path.exists(t['out']) and os.path.exists(t['out'] + '.stats.json')
        except FileNotFoundError:
            return False
    pending = [t for t in tasks if not valid(t)]
    def lift(t):
        temp = t['out'] + '.%d.tmp' % os.getpid()
        try:
            with open(os.devnull, 'wb') as sink:
                subprocess.run(t['args'] + ['--out', temp], check=True, stdout=sink)
            # Invalidate the old generation BEFORE replacing any payload. A crash at
            # either rename can then never validate mismatched source/stats under key A.
            try: os.unlink(t['out'] + '.key')
            except FileNotFoundError: pass
            os.replace(temp, t['out'])
            os.replace(temp + '.stats.json', t['out'] + '.stats.json')
            with open(temp + '.key', 'w') as f:
                f.write(t['key'])
            os.replace(temp + '.key', t['out'] + '.key')
        finally:
            for p in (temp, temp + '.stats.json', temp + '.key'):
                if os.path.exists(p): os.unlink(p)
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        list(pool.map(lift, pending))
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    print(json.dumps({'lift_ms': round((time.monotonic()-start)*1000, 3),
                      'lift_peak_child_rss_bytes': int(rss if sys.platform == 'darwin' else rss*1024),
                      'chunks_lifted': len(pending), 'chunks_cached': len(tasks)-len(pending), 'lift_jobs': jobs}))


if __name__ == '__main__':
    try: main()
    except (subprocess.CalledProcessError, ValueError, OSError) as e: sys.exit('lift: %s' % e)
