#!/usr/bin/env python3
"""LANE-K7i: identical nonblocking permanent-inode slot locks on macOS/Linux.
75 means contention only. The caller's exit marker disambiguates real command exit 75.
The command inherits the lock so killing the supervisor cannot unlock live heavy work.
"""
import errno
import fcntl
import os
import subprocess
import sys

try:
    with open(sys.argv[1], 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN):
                sys.exit(75)
            raise
        result = subprocess.run(sys.argv[2:], pass_fds=(lock.fileno(),))
        sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
except (OSError, IndexError) as error:
    sys.exit('heavy slot: %s' % error)
