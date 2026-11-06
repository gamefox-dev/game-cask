#!/usr/bin/env python3
"""Bounded lifter invocation. Hash-verified commit marker is always published last."""
import concurrent.futures
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


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


run_command = runpy.run_path(str(Path(__file__).with_name('command.py')))['run']


def main():
    # Shared with compile.py: finite regular-file stdin from exec.mjs.
    cfg = json.load(sys.stdin)
    jobs, memory = runpy.run_path(str(Path(__file__).with_name('parallel.py')))['parallelism'](cfg.get('jobs'), 'lift')
    tasks = cfg['tasks']
    def valid(t):
        try:
            with open(t['out'] + '.key') as f: marker = json.load(f)
            return (marker['key'] == t['key'] and marker['source'] == digest(t['out']) and
                    marker['stats'] == digest(t['out'] + '.stats.json'))
        except (FileNotFoundError, ValueError, KeyError, TypeError): return False
    pending = [t for t in tasks if not valid(t)]
    def lift(t):
        temp = t['out'] + '.' + uuid.uuid4().hex + '.tmp'
        try:
            start = time.monotonic()
            with open(os.devnull, 'wb') as sink:
                run_command(t['args'] + ['--out', temp], check=True, stdout=sink)
            elapsed = (time.monotonic()-start)*1000
            with open(temp + '.stats.json') as f: stats = json.load(f)
            marker = {'key': t['key'], 'source': digest(temp), 'stats': digest(temp + '.stats.json')}
            try: os.unlink(t['out'] + '.key')
            except FileNotFoundError: pass
            os.replace(temp, t['out'])
            os.replace(temp + '.stats.json', t['out'] + '.stats.json')
            with open(temp + '.key', 'w') as f: json.dump(marker, f, sort_keys=True)
            os.replace(temp + '.key', t['out'] + '.key')
            return {'source': t['out'], 'duration_ms': elapsed, 'analysis_cpu_ms': stats.get('analysis_cpu_ms', 0),
                    'c_generation_cpu_ms': stats.get('c_generation_cpu_ms', 0)}
        finally:
            for p in (temp, temp + '.stats.json', temp + '.key'):
                if os.path.exists(p): os.unlink(p)
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool: timings = list(pool.map(lift, pending))
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    print(json.dumps({'lift_ms': round((time.monotonic()-start)*1000, 3),
                      'lift_peak_child_rss_bytes': int(rss if sys.platform == 'darwin' else rss*1024),
                      'lift_analysis_cpu_ms': sum(t['analysis_cpu_ms'] for t in timings),
                      'c_generation_cpu_ms': sum(t['c_generation_cpu_ms'] for t in timings),
                      'lift_task_timings': timings, 'memory': memory,
                      'chunks_lifted': len(pending), 'chunks_cached': len(tasks)-len(pending), 'lift_jobs': jobs}))


if __name__ == '__main__':
    try: main()
    except (subprocess.CalledProcessError, ValueError, OSError) as e: sys.exit('lift: %s' % e)
