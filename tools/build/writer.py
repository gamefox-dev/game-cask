#!/usr/bin/env python3
"""Bounded build process group, optionally holding a writer lease.
The guardian drains this shared lock before regranting its main exclusive lock.
A late-starting helper must check the token while holding the shared lock.
"""
import fcntl
import json
import os
import signal
import subprocess
import sys

# Node starts a detached group. Also allow direct invocation outside Node.
if os.getpgrp() != os.getpid():
    os.setsid()
token, timeout, phase = sys.argv[1:4]
args = sys.argv[4:]


def abort(reason):
    # Do not just kill subprocess.run's immediate child: compilers and wasm-opt
    # can have grandchildren holding output pipes and cache/writer locks.
    message = 'build helper %s: phase=%s, timeout=%sms, argv=%s\n' % (reason, phase, timeout, json.dumps(args))
    try: os.write(2, message.encode())
    finally: os.killpg(os.getpgrp(), signal.SIGKILL)


signal.signal(signal.SIGALRM, lambda *_: abort('timed out'))
signal.signal(signal.SIGTERM, lambda *_: abort('cancelled'))
signal.signal(signal.SIGINT, lambda *_: abort('cancelled'))
signal.setitimer(signal.ITIMER_REAL, int(timeout) / 1000)
fd = None
try:
    if token != '-':
        try: fd = os.open(token + '.writers', os.O_RDWR)
        except FileNotFoundError: sys.exit('build writer lease expired')
        fcntl.flock(fd, fcntl.LOCK_SH)
        if not os.path.exists(token): sys.exit('build writer lease expired')
    result = subprocess.run(args, pass_fds=(() if fd is None else (fd,)))
    if result.returncode:
        abort('failed (exit %s)' % result.returncode)
finally:
    if fd is not None: os.close(fd)
