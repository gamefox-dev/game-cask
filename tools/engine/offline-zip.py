#!/usr/bin/env python3
"""Only used AFTER allowlist SHA verification. Never extracts arbitrary paths."""
import json
import os
import stat
import sys
import zipfile

src, dst, names_json = sys.argv[1:]
names = json.loads(names_json)
with zipfile.ZipFile(src) as z:
    found = {}
    total = 0
    for i in z.infolist():
        # Validate ALL entries, including directories, before ignoring any of them.
        name = i.orig_filename
        path = name[:-1] if i.is_dir() else name
        if not path or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 or ord(c) == 127 for c in name) or any(p in ('', '.', '..') for p in path.split('/')):
            raise ValueError('unsafe zip path')
        mode = i.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or i.flag_bits & 1:
            raise ValueError('non-plain/encrypted zip member')
        if kind == stat.S_IFDIR and not i.is_dir() or kind == stat.S_IFREG and i.is_dir():
            raise ValueError('inconsistent zip member type')
        if i.is_dir():
            continue
        total += i.file_size
        if total > 256 * 1024 * 1024 or i.file_size > 128 * 1024 * 1024:
            raise ValueError('runtime archive too large')
        base = name.rsplit('/', 1)[-1]
        if base in found:
            raise ValueError('duplicate runtime member')
        found[base] = i
    if any(n.endswith('.worker.js') and not n.endswith('.service.worker.js') for n in found):
        raise ValueError('threads runtime not allowlisted')
    for name in names:
        if name not in found:
            raise ValueError('missing runtime member: ' + name)
    os.makedirs(dst, exist_ok=False)
    for name in names:
        with open(os.path.join(dst, name), 'xb') as f:
            f.write(z.read(found[name]))
