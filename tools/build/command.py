"""Portable child transport: never send build payloads through OS argv/env.

The anonymous response/config fd is inherited by the immediate child and stays
open until it exits. A group SIGKILL cannot leave private payloads in /tmp.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile


def check_budget(args, env):
    # Linux: MAX_ARG_STRLEN includes NUL; leave room below the usual 2 MiB ARG_MAX
    # for argv/env pointers, the supervisor and platform-specific accounting.
    strings = list(args) + [k + '=' + v for k, v in env.items()]
    if any(len(os.fsencode(a)) + 1 > 131072 for a in strings) or sum(len(os.fsencode(a)) + 1 + 8 for a in strings) > 1048576:
        raise ValueError('child argv/environment exceeds portable Linux budget: ' + args[0])


def run(args, **kwargs):
    env = kwargs.get('env')
    if env is None:
        env = os.environ
    large = any(len(os.fsencode(a)) >= 65536 for a in args) or sum(len(os.fsencode(a)) + 1 for a in args) > 262144
    if not large:
        check_budget(args, env)
        return subprocess.run(args, **kwargs)
    name = os.path.basename(args[0])
    with tempfile.TemporaryFile(mode='w+', encoding='utf8') as payload:
        path = '/dev/fd/' + str(payload.fileno())
        if name in ('node', 'nodejs') and len(args) > 1 and args[1].endswith('.mjs'):
            json.dump(args[1:], payload)
            transported = [args[0], str(Path(__file__).with_name('node-args.mjs')), path]
        elif name in ('cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'zig') or name.startswith(('gcc-', 'clang-')):
            prefix = 2 if name == 'zig' and len(args) > 1 and args[1] in ('cc', 'c++') else 1
            # GCC/Clang/Zig use GNU quoting; JSON is NOT a response-file grammar.
            for arg in args[prefix:]:
                payload.write('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
            transported = args[:prefix] + ['@' + path]
        else:
            raise ValueError('large argv requires a file transport: ' + args[0])
        payload.flush()
        payload.seek(0)
        check_budget(transported, env)
        kwargs['pass_fds'] = (*kwargs.get('pass_fds', ()), payload.fileno())
        return subprocess.run(transported, **kwargs)
