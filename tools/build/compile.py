#!/usr/bin/env python3
"""Measured parallel object compilation. Stdlib, macOS/Linux. Input/output JSON over stdin/stdout.
Objects are content-addressed by the caller (all sources, headers, compiler identity and flags).
Never execute a guest program. Each child is a compiler or wasm postprocessor supplied by the kit.
"""
import concurrent.futures
import json
import os
import resource
import subprocess
import sys
import time


def command(args):
    start = time.monotonic()
    subprocess.run(args, check=True, stdout=sys.stderr)
    return round((time.monotonic() - start) * 1000, 3)


def main():
    cfg = json.load(sys.stdin)
    jobs = max(1, min(8, int(cfg.get('jobs', 2))))
    pending = [o for o in cfg.get('objects', []) if not os.path.exists(o['out'])]
    def compile_one(o):
        temp = o['out'] + '.%d.tmp' % os.getpid()
        try:
            command(o['args'] + ['-o', temp])
            os.replace(temp, o['out'])
        finally:
            if os.path.exists(temp): os.unlink(temp)
    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        list(pool.map(compile_one, pending))
    if cfg.get('link'): command(cfg['link'])
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    # macOS reports bytes, Linux KiB. This is max single child RSS, NOT total concurrent RSS.
    peak = int(rss if sys.platform == 'darwin' else rss * 1024)
    print(json.dumps({'duration_ms': round((time.monotonic()-start)*1000, 3), 'peak_child_rss_bytes': peak,
                      'objects_compiled': len(pending), 'objects_cached': len(cfg.get('objects', []))-len(pending), 'jobs':jobs}))


if __name__ == '__main__':
    try: main()
    except (subprocess.CalledProcessError, ValueError, OSError) as e: sys.exit('compile: %s' % e)
