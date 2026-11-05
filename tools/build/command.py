"""Portable supervised child transport, including compiler descendants.

Anonymous fds keep build payloads private even when the process group is killed.
Transport headers are removed from dependency output before their fd is closed;
only the original semantic flags enter object/cache identity.
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
    # Command-line -D is tokenized at phase three: an embedded newline truncates
    # the definition; it must not reorder a preceding -U behind a remaining -D.
    spec = re.split(r'[\r\n]', value if value is not None else option[2:], 1)[0]
    match = _MACRO.fullmatch(spec)
    if not match or (kind == 'U' and (match.group(2) is not None or '(' in match.group(1))):
        raise ValueError('macro has no safe file transport: ' + option[:80])
    name, replacement = match.groups()
    if kind == 'U':
        return '#undef ' + name
    replacement = '1' if replacement is None else replacement
    # Reject unterminated block comments rather than letting them consume the
    # next definition. Quoted comment spellings are ordinary replacement tokens.
    tokens = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//.*|/\*.*?\*/', '', replacement)
    if '/*' in tokens or '??' in replacement:
        raise ValueError('macro has no safe file transport: unterminated comment or trigraph')
    # A terminal backslash is a token in -D, not a source-line splice. A comment
    # guard prevents phase-two splicing, then disappears in phase three.
    return '#define ' + name + ' ' + replacement + ' /**/'


def compiler_macro_transport(args, prefix):
    rest, lines = [], []
    i = prefix
    while i < len(args):
        option = args[i]
        if option in ('-D', '-U'):
            if i + 1 == len(args):
                raise ValueError('macro has no safe file transport: missing value')
            lines.append(extract_macro(option, args[i + 1]))
            i += 2
        elif option.startswith(('-D', '-U')):
            lines.append(extract_macro(option))
            i += 1
        else:
            rest.append(option)
            i += 1
    return rest, lines


def check_budget(args, env):
    strings = list(args) + [k + '=' + v for k, v in env.items()]
    if any(len(os.fsencode(a)) + 1 > 131072 for a in strings) or sum(len(os.fsencode(a)) + 1 + 8 for a in strings) > 1048576:
        raise ValueError('child argv/environment exceeds portable Linux budget: ' + args[0])


def expand_compiler_responses(args, cwd, stack=()):
    # GNU driver response grammar: backslash quotes the next character inside
    # either quote style too (unlike shell/shlex single quotes). Relative nested
    # filenames resolve from compiler cwd, never from the containing file.
    result = []
    for arg in args:
        if not arg.startswith('@'):
            result.append(arg)
            continue
        path = os.path.abspath(os.path.join(cwd or os.getcwd(), arg[1:]))
        if path in stack or len(stack) >= 32:
            raise ValueError('compiler response file recursion has no safe file transport')
        text = Path(path).read_text(encoding='utf8', errors='surrogateescape')
        words, word, quote, started = [], '', None, False
        i = 0
        while i < len(text):
            c = text[i]
            if c == '\\':
                i += 1
                if i == len(text): raise ValueError('compiler response file ends in an escape')
                word += text[i]; started = True
            elif c in ('"', "'") and (quote is None or quote == c):
                quote = None if quote else c; started = True
            elif c.isspace() and quote is None:
                if started: words.append(word)
                word, started = '', False
            else:
                word += c; started = True
            i += 1
        if quote: raise ValueError('compiler response file has an unterminated quote')
        if started: words.append(word)
        result.extend(expand_compiler_responses(words, cwd, (*stack, path)))
    return result


def compiler_options_size(args):
    # GCC quotes options again into one COLLECT_GCC_OPTIONS environment string.
    # Positional input lists are NOT options; they remain bounded by check_budget.
    # Count option operands conservatively, including any filename after an
    # option. This also covers -include/-Xlinker/-o operands with input suffixes.
    inputs = ('.o', '.a', '.c', '.cc', '.cpp', '.cxx', '.s', '.S', '.bc', '.ll', '.wasm')
    options = [a for i, a in enumerate(args) if a.startswith('-') or not a.endswith(inputs) or i == 0 or args[i-1].startswith('-')]
    return sum(len(os.fsencode(a)) + 3 + 3 * a.count("'") for a in options)


def check_compiler_budget(args, env):
    # Half MAX_ARG_STRLEN leaves room for the driver's implicit/dump/target
    # options, plus any later quoting. Checking only @response argv is unsound.
    if compiler_options_size(args) > 65536:
        raise ValueError('compiler descendant options exceed portable Linux budget; no file transport for residual non-macro options')
    check_budget(args, env)


def dependency_output(args, cwd):
    def value(flag):
        result = None
        for i, a in enumerate(args):
            if a == flag and i + 1 < len(args): result = args[i + 1]
            elif a.startswith(flag) and len(a) > len(flag): result = a[len(flag):]
        return result
    mf = value('-MF')
    only = '-M' in args or '-MM' in args
    if not (mf or only or '-MD' in args or '-MMD' in args): return None, False
    output = value('-o')
    if mf: path = mf
    elif only: path = output
    else:
        source = next((a for a in args if a.endswith(('.c', '.cc', '.cpp', '.cxx', '.s', '.S'))), None)
        path = str(Path(output or os.path.basename(source or 'a.o')).with_suffix('.d'))
    return (os.path.join(cwd or os.getcwd(), path) if path else None), only and not path


def without_dependency(data, path):
    binary = isinstance(data, bytes)
    text = data.decode('utf8', errors='surrogateescape') if binary else data
    # GNU make escaping; remove this one complete prerequisite, not real headers.
    escaped = path.replace('\\', '\\\\').replace('$', '$$').replace('#', '\\#').replace(' ', '\\ ').replace('\t', '\\\t')
    text = re.sub(r'(?m)^' + re.escape(escaped) + r':[ \t]*\n', '', text)
    text = re.sub(r'(?<!\S)' + re.escape(escaped) + r'(?=\s|$)', '', text)
    return text.encode('utf8', errors='surrogateescape') if binary else text


def run_compiler(args, original, macro_path, kwargs):
    if macro_path is None: return subprocess.run(args, **kwargs)
    depfile, depstdout = dependency_output(original, kwargs.get('cwd'))
    stdout = kwargs.get('stdout')
    if depstdout:
        if kwargs.pop('capture_output', False):
            if stdout is not None or kwargs.get('stderr') is not None: raise ValueError('capture_output conflicts with stdout/stderr')
            stdout = subprocess.PIPE
            kwargs['stderr'] = subprocess.PIPE
        kwargs['stdout'] = subprocess.PIPE
    result = subprocess.run(args, **kwargs)
    if depfile and os.path.exists(depfile):
        with open(depfile, 'rb') as f: data = f.read()
        with open(depfile, 'wb') as f: f.write(without_dependency(data, macro_path))
    if depstdout:
        result.stdout = without_dependency(result.stdout, macro_path)
        if stdout == subprocess.DEVNULL:
            result.stdout = None
        elif stdout != subprocess.PIPE:
            data = result.stdout
            if isinstance(data, str): data = data.encode(kwargs.get('encoding') or 'utf8')
            target = 1 if stdout is None else stdout if isinstance(stdout, int) else stdout.fileno()
            # os.write may be partial for large dependency listings.
            while data:
                n = os.write(target, data)
                data = data[n:]
            result.stdout = None
    return result


def run(args, **kwargs):
    env = kwargs.get('env')
    if env is None: env = os.environ
    name = os.path.basename(args[0])
    compiler = name in ('cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'zig') or name.startswith(('gcc-', 'g++-', 'clang-'))
    if compiler and any(a.startswith('@') for a in args[1:]):
        args = [args[0], *expand_compiler_responses(args[1:], kwargs.get('cwd'))]
    large = any(len(os.fsencode(a)) >= 65536 for a in args) or sum(len(os.fsencode(a)) + 1 for a in args) > 262144
    if compiler: large |= compiler_options_size(args) > 65536
    if not large:
        if compiler: check_compiler_budget(args, env)
        else: check_budget(args, env)
        return subprocess.run(args, **kwargs)
    with tempfile.TemporaryFile(mode='w+', encoding='utf8') as payload, tempfile.TemporaryFile(mode='w+', encoding='utf8') as macro:
        path = '/dev/fd/' + str(payload.fileno())
        macro_path = None
        fds = [payload.fileno()]
        if name in ('node', 'nodejs') and len(args) > 1 and args[1].endswith('.mjs'):
            json.dump(args[1:], payload)
            transported = [args[0], str(Path(__file__).with_name('node-args.mjs')), path]
        elif compiler:
            prefix = 2 if name == 'zig' and len(args) > 1 and args[1] in ('cc', 'c++') else 1
            compiler_args, macros = compiler_macro_transport(args, prefix)
            if macros:
                macro.write('#line 1 "<command-line>"\n' + '\n'.join(macros) + '\n')
                macro.flush(); macro.seek(0)
                macro_path = '/dev/fd/' + str(macro.fileno())
                # Command-line macros run BEFORE all user -imacros and
                # -include files. This must be the FIRST -imacros input.
                compiler_args = ['-imacros', macro_path] + compiler_args
                fds.append(macro.fileno())
            compiler_args = args[:prefix] + compiler_args
            check_compiler_budget(compiler_args, env)
            for arg in compiler_args[prefix:]:
                payload.write('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
            transported = compiler_args[:prefix] + ['@' + path]
        else:
            raise ValueError('large argv requires a file transport: ' + args[0])
        payload.flush(); payload.seek(0)
        check_budget(transported, env)
        kwargs['pass_fds'] = (*kwargs.get('pass_fds', ()), *fds)
        return run_compiler(transported, args, macro_path, kwargs)
