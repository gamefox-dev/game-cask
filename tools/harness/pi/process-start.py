#!/usr/bin/env python3
"""LANE-K7i: stable PID incarnation without ps (denied by the lane sandbox).
macOS libproc reads the same kernel BSD start time as ps; Linux reads /proc/stat.
An unavailable/dead PID prints nothing, and heavy work consequently fails closed.
"""
import ctypes
import os
import sys


def started(pid):
    if sys.platform == 'darwin':
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        lib.proc_pidinfo.restype = ctypes.c_int
        data = ctypes.create_string_buffer(136)  # Darwin struct proc_bsdinfo, including timeval start
        if lib.proc_pidinfo(pid, 3, 0, data, len(data)) != len(data):
            return ''
        if ctypes.c_uint32.from_buffer(data, 12).value != pid or ctypes.c_uint32.from_buffer(data, 4).value == 5:
            return ''  # stale/zombie, not a live waiter
        seconds = ctypes.c_uint64.from_buffer(data, 120).value
        micros = ctypes.c_uint64.from_buffer(data, 128).value
        return '%d.%06d' % (seconds, micros)
    if sys.platform.startswith('linux'):
        with open('/proc/%d/stat' % pid) as f:
            fields = f.read().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return ''
        with open('/proc/sys/kernel/random/boot_id') as f:
            boot = f.read().strip()
        return boot + ':' + fields[19]  # field 22, starttime since boot
    return ''


if __name__ == '__main__':
    try:
        pid = int(sys.argv[1])
        if pid <= 0:
            raise ValueError('invalid pid')
        os.kill(pid, 0)
        value = started(pid)
        if not value:
            sys.exit(1)
        print(value)
    except (ValueError, OSError, IndexError):
        sys.exit(1)
