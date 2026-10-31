#!/usr/bin/env python3
"""Kernel-owned advisory lock; permanent inode, never stale-path deletion.
A detached FD guardian watches a release token AND kernel owner-exit notifications.
"""
import fcntl
import os
import select
import sys
import tempfile
import time

path, owner, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
start = time.monotonic()
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() - start > timeout:
            sys.exit('file lock timeout: ' + path)
        time.sleep(0.01)
release_fd, token = tempfile.mkstemp(prefix='.release-', dir=os.path.dirname(path))
os.close(release_fd)
writers = token + '.writers'
writer_fd = os.open(writers, os.O_CREAT | os.O_RDWR, 0o600)
ready_read, ready_write = os.pipe()
try:
    pid = os.fork()
except OSError:
    os.unlink(token)
    raise
if pid:
    os.close(ready_write)
    ready = os.read(ready_read, 1)
    os.close(ready_read)
    os.close(fd)
    os.close(writer_fd)
    if ready != b'1':
        try: os.unlink(token)
        except FileNotFoundError: pass
        sys.exit('file lock guardian could not watch owner exit')
    print(token, flush=True)
else:
    os.setsid()  # isolate before acknowledgement: caller group signals cannot drop the lease
    os.close(ready_read)
    for stream in (0, 1, 2):
        try: os.close(stream)
        except OSError: pass
    watcher = None
    try:
        # kill(pid,0) succeeds for zombies. Exit notifications do not depend on
        # the owner's parent reaping it; no PID reuse window after registration.
        if sys.platform == 'darwin':
            watcher = select.kqueue()
            watcher.control([select.kevent(owner, filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE,
                fflags=select.KQ_NOTE_EXIT)], 0, 0)
            dead = lambda: bool(watcher.control([], 1, 0))
        else:
            watcher = os.pidfd_open(owner)
            dead = lambda: bool(select.select([watcher], [], [], 0)[0])
        os.write(ready_write, b'1')
        os.close(ready_write)
        while os.path.exists(token) and not dead():
            time.sleep(0.01)
    finally:
        if watcher is not None:
            if sys.platform == 'darwin': watcher.close()
            else: os.close(watcher)
        # Outstanding helpers can still write after the Node owner exits. Drain them
        # before removing the token or regranting the main lock. Late helpers must
        # validate the token under SH, so they cannot race this exclusive barrier.
        fcntl.flock(writer_fd, fcntl.LOCK_EX)
        try: os.unlink(token)
        except FileNotFoundError: pass
        try: os.unlink(writers)
        except FileNotFoundError: pass
        os.close(writer_fd)
        os.close(fd)
        os._exit(0)
