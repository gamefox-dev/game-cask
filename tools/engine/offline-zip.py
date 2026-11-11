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
        if i.is_dir():
            continue
        name = i.filename
        if name.startswith('/') or '\\' in name or any(p in ('', '.', '..') for p in name.split('/')):
            raise ValueError('unsafe zip path')
        if stat.S_ISLNK(i.external_attr >> 16) or i.flag_bits & 1:
            raise ValueError('symlink/encrypted zip member')
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
