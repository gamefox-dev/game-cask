"""Portable child command transport. Keep payloads out of OS argv (Linux MAX_ARG_STRLEN).
Response files are private, live through child exit, and owned by the supervisor group.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile


def run(args, **kwargs):
    # Leave headroom for the supervisor, argv pointers and the inherited environment.
    large = any(len(os.fsencode(a)) >= 65536 for a in args) or sum(len(os.fsencode(a)) + 1 for a in args) > 262144
    with tempfile.TemporaryDirectory(prefix='bgt-argv-') as directory:
        if large:
            name = os.path.basename(args[0])
            if name in ('node', 'nodejs') and len(args) > 1 and args[1].endswith('.mjs'):
                path = os.path.join(directory, 'argv.json')
                with open(path, 'w') as f: json.dump(args[1:], f)
                args = [args[0], str(Path(__file__).with_name('node-args.mjs')), path]
            elif name in ('cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'zig') or name.startswith(('gcc-', 'clang-')):
                prefix = 2 if name == 'zig' and args[1] in ('cc', 'c++') else 1
                path = os.path.join(directory, 'args.rsp')
                # GCC/Clang/Zig use GNU quoting; JSON is NOT a response-file grammar.
                with open(path, 'w') as f:
                    for arg in args[prefix:]:
                        f.write('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
                args = args[:prefix] + ['@' + path]
            else:
                raise ValueError('large argv requires a file transport: ' + args[0])
        env = kwargs.get('env') or os.environ
        strings = args + [k + '=' + v for k, v in env.items()]
        if any(len(os.fsencode(a)) + 1 > 131072 for a in strings) or sum(len(os.fsencode(a)) + 1 + 8 for a in strings) > 1048576:
            raise ValueError('child argv/environment exceeds portable Linux budget: ' + args[0])
        return subprocess.run(args, **kwargs)
