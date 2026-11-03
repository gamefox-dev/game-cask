#!/usr/bin/env python3
"""Use the heavy gate's physical-headroom probe, not total RAM or swap."""
import os
from pathlib import Path
import runpy
import subprocess

MB = 1024 * 1024


def parallelism(requested=None, kind='compile'):
    cap = int(requested if requested is not None else os.environ.get('BGT_BUILD_JOBS', '4'))
    if cap < 1 or cap > 8:
        raise ValueError('BGT_BUILD_JOBS/jobs must be an integer in 1..8')
    reserve = 1024 * MB
    per_worker = (1024 if kind == 'compile' else 768) * MB
    try:
        probe = Path(__file__).resolve().parents[1] / 'harness/pi/shim/memory.py'
        free = runpy.run_path(str(probe))['available']()
        jobs = max(1, min(cap, os.cpu_count() or 1, (free - reserve) // per_worker))
        error = None
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        # Never increase concurrency when the reading is unknown.
        free, jobs, error = None, 1, str(e)
    return int(jobs), {'available_bytes': free, 'reserve_bytes': reserve,
                       'per_worker_bytes': per_worker, 'cap': cap, 'probe_error': error,
                       'scope': 'heavy-gate physical headroom at phase entry; not a reservation'}
