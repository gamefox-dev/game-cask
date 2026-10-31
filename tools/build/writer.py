#!/usr/bin/env python3
"""Writer lease around a build child. Survives the owner's process-group signals.
The guardian drains this shared lock before regranting its main exclusive lock.
A late-starting helper must check the token while holding the shared lock.
"""
import fcntl
import os
import subprocess
import sys

os.setsid()
token = sys.argv[1]
try: fd = os.open(token + '.writers', os.O_RDWR)
except FileNotFoundError: sys.exit('build writer lease expired')
try:
    fcntl.flock(fd, fcntl.LOCK_SH)
    if not os.path.exists(token): sys.exit('build writer lease expired')
    result = subprocess.run(sys.argv[2:], pass_fds=(fd,))
    sys.exit(result.returncode if result.returncode >= 0 else 128-result.returncode)
finally:
    os.close(fd)
