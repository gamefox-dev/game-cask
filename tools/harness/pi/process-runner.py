#!/usr/bin/env python3
"""Wait for a private process group, forward cancellation, reap before returning."""
import os
import signal
import subprocess
import sys

child = subprocess.Popen(sys.argv[1:], start_new_session=True)
cancelled = [None]


def stop(signum, _frame):
    cancelled[0] = signum
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, stop)
while True:
    try:
        code = child.wait(timeout=1)
        break
    except subprocess.TimeoutExpired:
        if cancelled[0]:
            try:
                # Let run-pi reap its separately grouped worker and publish lifecycle first.
                code = child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                code = child.wait()
            break
if cancelled[0]:
    # A shell may have exited before its children. Kill any remaining group members.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
sys.exit(128 + cancelled[0] if cancelled[0] else (128 - code if code < 0 else code))
