#!/usr/bin/env python3
"""Available physical headroom, not swap. Unknown readings wait closed, never grant."""
import os
from pathlib import Path
import re
import subprocess
import sys

MB = 1024 * 1024


def linux_available(raw):
    match = re.search(r'^MemAvailable:\s+(\d+)\s+kB\s*$', raw, re.M)
    if not match:
        raise ValueError('MemAvailable unavailable')
    return int(match[1]) * 1024


def mac_available(raw, total):
    page = re.search(r'page size of (\d+) bytes', raw)
    if not page or int(page[1]) <= 0 or total <= 0:
        raise ValueError('invalid vm_stat/sysctl')
    # Inactive pages are reclaimable; do not count active, wired, compressed or swap.
    values = []
    for name in ('free', 'inactive', 'speculative'):
        match = re.search(r'^Pages ' + name + r':\s+(\d+)\.', raw, re.M)
        if not match:
            raise ValueError('missing vm_stat Pages ' + name)
        values.append(int(match[1]))
    available = sum(values) * int(page[1])
    if available > total:
        raise ValueError('vm_stat exceeds hw.memsize')
    return available


def available():
    # Explicit operator/test snapshot of Linux MemAvailable format; never enabled implicitly.
    snapshot = os.environ.get('BGT_HEAVY_MEMINFO_FILE')
    if snapshot:
        return linux_available(Path(snapshot).read_text())
    if sys.platform.startswith('linux'):
        return linux_available(Path('/proc/meminfo').read_text())
    if sys.platform == 'darwin':
        def run(*args):
            return subprocess.check_output(args, text=True, timeout=5)
        return mac_available(run('/usr/bin/vm_stat'), int(run('/usr/sbin/sysctl', '-n', 'hw.memsize').strip()))
    raise ValueError('unsupported memory probe platform')


def main():
    try:
        threshold = int(os.environ.get('BGT_HEAVY_MIN_FREE_MB', '1024'))
        if threshold < 0:
            raise ValueError()
    except ValueError:
        print('invalid BGT_HEAVY_MIN_FREE_MB')
        return 2
    if threshold == 0:
        print('memory check disabled min_free_mb=0')
        return 0
    try:
        free = available() // MB
        print('memory free_mb=%d min_free_mb=%d' % (free, threshold))
        return 0 if free >= threshold else 75
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('memory unavailable: ' + str(error))
        return 75


if __name__ == '__main__':
    sys.exit(main())
