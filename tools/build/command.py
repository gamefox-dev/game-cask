"""Portable child transport: never send build payloads through OS argv/env.

The anonymous response/config fd is inherited by the immediate child and stays
open until it exits. A group SIGKILL cannot leave private payloads in /tmp.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import re


_MACRO = re.compile(r'([A-Za-z_][A-Za-z0-9_]*(?:\([^\r\n)]*\))?)(?:=(.*))?\Z', re.S)


def extract_macro(option, value=None):
    kind = option[1]
    spec = value if value is not None else option[2:]
    if not spec or '\n' in spec or '\r' in spec:
        return None
    match = _MACRO.fullmatch(spec)
    if not match or (kind == 'U' and match.group(2) is not None):
        return None
    name, replacement = match.groups()
    if kind == 'U':
        return '#undef ' + name
    # -DNAME (including function-like -DNAME(x)) means 1, not an empty body.
    return '#define ' + name + ' ' + ('1' if replacement is None else replacement)


def compiler_macro_transport(args, prefix):
    """Move -D/-U payloads into a forced-include file before cc1 sees argv.

    A compiler response file bounds the driver's argv, but GCC expands it before
    spawning cc1. A sufficiently large set of definitions can therefore still
    hit Linux E2BIG in the driver's child. The header is the same file-backed
    transport, and keeps macro spelling/ordering without putting the payload in
    either process argv.
    """
    rest, lines = [], []
    i = prefix
    while i < len(args):
        option = args[i]
        if option in ('-D', '-U') and i + 1 < len(args):
            line = extract_macro(option, args[i + 1])
            if line is not None:
                lines.append(line)
                i += 2
                continue
        elif option.startswith(('-D', '-U')) and len(option) > 2:
            line = extract_macro(option)
            if line is not None:
                lines.append(line)
                i += 1
                continue
        rest.append(option)
        i += 1
    return rest, lines


def check_budget(args, env):
    # Linux: MAX_ARG_STRLEN includes NUL; leave room below the usual 2 MiB ARG_MAX
    # for argv/env pointers, the supervisor and platform-specific accounting.
    strings = list(args) + [k + '=' + v for k, v in env.items()]
    if any(len(os.fsencode(a)) + 1 > 131072 for a in strings) or sum(len(os.fsencode(a)) + 1 + 8 for a in strings) > 1048576:
        raise ValueError('child argv/environment exceeds portable Linux budget: ' + args[0])


def run(args, **kwargs):
    macro = None
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
            # GCC expands @files before spawning cc1, so move large macro payloads
            # into a forced include as well as using the response file.
            compiler_args, macros = compiler_macro_transport(args, prefix)
            if macros:
                macro = tempfile.TemporaryFile(mode='w+', encoding='utf8')
                macro.write('\n'.join(macros) + '\n')
                macro.flush()
                macro.seek(0)
                macro_path = '/dev/fd/' + str(macro.fileno())
                compiler_args = args[:prefix] + ['-include', macro_path] + compiler_args
            else:
                compiler_args = args[:prefix] + compiler_args
            for arg in compiler_args[prefix:]:
                payload.write('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
            transported = compiler_args[:prefix] + ['@' + path]
        else:
            raise ValueError('large argv requires a file transport: ' + args[0])
        payload.flush()
        payload.seek(0)
        check_budget(transported, env)
        fds = [payload.fileno()]
        if macro is not None: fds.append(macro.fileno())
        kwargs['pass_fds'] = (*kwargs.get('pass_fds', ()), *fds)
        try:
            return subprocess.run(transported, **kwargs)
        finally:
            if macro is not None: macro.close()
