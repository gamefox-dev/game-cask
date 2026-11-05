"""Portable supervised child transport, including compiler descendants.

Anonymous fds keep argv payloads private even when the process group is killed.
Macro headers live in a private temporary directory; supported dependency outputs
are sanitized before cleanup. Only original semantic flags enter cache identity.
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


# Transport's accepted grammar is intentionally narrower than a compiler's.
# These are kit compile/link/probe options, plus the explicit short dependency
# forms and real-descendant test wrapper. Do not forward unknown options: new
# driver aliases can create outputs that expose or depend on the private header.
_TRANSPORT_FLAGS = frozenset({
    '-c', '-E', '-P', '-s', '-M', '-MM', '-MD', '-MMD', '-MP', '-MG',
    '-std=c11', '-O1', '-O2', '-g0',
    '-ffreestanding', '-fno-stack-protector', '-fno-math-errno',
    '-ffunction-sections', '-fdata-sections', '-nostdlib',
    '-mcpu=i686', '-funwind-tables', '-fno-lto', '-fno-emulated-tls',
    '-Wl,--entry,entry', '-ladvapi32', '-lavrt', '-lbcrypt', '-ldinput8',
    '-ldwmapi', '-ldxguid', '-lgdi32', '-limm32', '-liphlpapi', '-lkernel32',
    '-lole32', '-lopengl32', '-lpropsys', '-lshell32', '-lshlwapi', '-luser32',
    '-luuid', '-lws2_32', '-lwsock32', '-lxinput1_4',
    '-mbulk-memory', '-mnontrapping-fptoint', '-msign-ext', '-mexec-model=reactor',
    '--target=wasm32-freestanding', '--target=wasm32-wasi',
    '-Wall', '-Wextra', '-Werror', '-Wsystem-headers', '-Werror=date-time',
    '-Wno-unused-function', '-Wno-unused-label', '-Wno-unused-but-set-variable',
    '-Wno-unused-variable', '-Wno-builtin-macro-redefined',
    '-Wl,--no-entry', '-Wl,--strip-debug', '-Wl,-z,stack-size=1048576',
    '-Wl,--gc-sections', '-Wl,--subsystem,windows', '-Wl,--image-base,0x140000000',
})
_TRANSPORT_OPERANDS = frozenset({
    '-I', '-isystem', '-iquote', '-idirafter', '-include', '-imacros',
    '-o', '-MF', '-MT', '-MQ', '-D', '-U', '-wrapper', '-x', '-target',
})

def validate_transport_options(args):
    prefix = 2 if os.path.basename(args[0]) == 'zig' and len(args) > 1 and args[1] in ('cc', 'c++') else 1
    i = prefix
    while i < len(args):
        a = args[i]
        if a in _TRANSPORT_OPERANDS:
            if i + 1 >= len(args):
                raise ValueError('compiler macro transport: missing operand for ' + a)
            if a == '-x' and args[i + 1] != 'c':
                raise ValueError('compiler macro transport supports only -x c')
            if a == '-target' and args[i + 1] not in ('x86-windows-gnu', 'x86_64-windows-gnu'):
                raise ValueError('compiler macro transport: unsupported target')
            i += 2
            continue
        if a in _TRANSPORT_FLAGS:
            i += 1
            continue
        # Exact prefix forms with semantic operands, never arbitrary -f/-W/-m.
        if any(a.startswith(p) and len(a) > len(p) for p in ('-D', '-U', '-I', '-MF', '-MT', '-MQ')):
            i += 1
            continue
        if any(a.startswith(p) and '=' in a[len(p):] for p in ('-ffile-prefix-map=', '-fmacro-prefix-map=')):
            i += 1
            continue
        if not a.startswith(('-', '@')):
            i += 1
            continue
        raise ValueError('compiler dependency output / option unsupported under macro transport: ' + a[:160] + '; use supported kit options (direct -MD/-MF for dependencies), or reduce options below the transport budget')


def dependency_output(args, cwd):
    """Return every dependency destination that transport can contaminate.

    GCC and Clang accept dependency switches both as driver options and through
    -Wp.  A forced macro file is an input to the preprocessor, so missing even
    one destination can leave /dev/fd/N in a cache depfile.  Unknown dependency
    spellings fail closed before the compiler runs.
    """
    validate_transport_options(args)
    base = cwd or os.getcwd()
    files, stdout = set(), False
    modes = set()
    explicit = []
    output = None
    explicit_destination = False
    i = 0
    def add_destination(value):
        nonlocal stdout, explicit_destination
        explicit_destination = True
        if value is None or value == '':
            raise ValueError('compiler dependency output has no destination; unsupported transport form')
        if value == '-': stdout = True
        else: explicit.append(value)
    while i < len(args):
        a = args[i]
        if a in ('-M', '-MM', '-MD', '-MMD'):
            modes.add(a)
        elif a in ('-MF', '-MT', '-MQ', '-o'):
            if i + 1 >= len(args):
                if a == '-MF': raise ValueError('compiler dependency output has missing -MF destination')
                i += 1
                continue
            if a == '-MF': add_destination(args[i + 1])
            elif a == '-o': output = args[i + 1]
            i += 1
        elif a.startswith('-MF') and len(a) > 3:
            add_destination(a[3:])
        elif a.startswith('-o') and len(a) > 2:
            output = a[2:]
        i += 1
    if not modes and not explicit_destination: return [], False
    if any(m in modes for m in ('-M', '-MM')) and not explicit_destination:
        if output: explicit.append(output)
        else: stdout = True
    if any(m in modes for m in ('-MD', '-MMD')) and not explicit_destination:
        # Driver default names depend on language, compile vs link, dumpbase,
        # multiple sources, and toolchain version. Do not guess one filename.
        raise ValueError('compiler dependency output with implicit .d names has no safe macro transport; supply explicit -MF PATH (or -MF - for stdout)')
    for path in explicit:
        files.add(path if os.path.isabs(path) else os.path.join(base, path))
    return files, stdout


def sanitize_transport(data, path):
    if data is None: return data
    binary = isinstance(data, bytes)
    text = data.decode('utf8', errors='surrogateescape') if binary else data
    # Syntax/preprocessor diagnostics may include the forced header's path even
    # without explicit diagnostic flags (-H/-v are rejected by the allowlist).
    text = text.replace(path, '<command-line.h>')
    return text.encode('utf8', errors='surrogateescape') if binary else text

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
    env = kwargs.get('env') or os.environ
    if any(env.get(key) for key in ('DEPENDENCIES_OUTPUT', 'SUNPRO_DEPENDENCIES')):
        raise ValueError('compiler dependency output through environment has no safe macro transport; use direct -MD/-MF options')
    depfiles, depstdout = dependency_output(original, kwargs.get('cwd'))
    stdout = kwargs.get('stdout')
    capture_output = kwargs.pop('capture_output', False)
    stderr_target = kwargs.get('stderr')
    if capture_output:
        if stdout is not None or stderr_target is not None: raise ValueError('capture_output conflicts with stdout/stderr')
        stdout = subprocess.PIPE
        stderr_target = subprocess.PIPE
    if depstdout: kwargs['stdout'] = subprocess.PIPE
    if capture_output:
        kwargs['stdout'] = subprocess.PIPE
    if stderr_target == subprocess.STDOUT:
        raise ValueError('compiler macro transport requires separate diagnostic output; do not merge stderr into stdout')
    if capture_output or stderr_target != subprocess.PIPE:
        # Capture diagnostics so the private macro path can be replaced before
        # forwarding it to the caller's original stream.
        kwargs['stderr'] = subprocess.PIPE
    # check=True must not bypass dependency sanitation on compiler errors.
    # TimeoutExpired may also carry dependency stdout and leave a partial file.
    check = kwargs.pop('check', False)
    try:
        result = subprocess.run(args, check=False, **kwargs)
    except subprocess.TimeoutExpired as error:
        if depstdout and error.output is not None:
            error.output = without_dependency(error.output, macro_path)
        error.stderr = sanitize_transport(error.stderr, macro_path)
        raise
    finally:
        for depfile in depfiles:
            if os.path.exists(depfile):
                with open(depfile, 'rb') as f: data = f.read()
                with open(depfile, 'wb') as f: f.write(without_dependency(data, macro_path))
    result.stderr = sanitize_transport(result.stderr, macro_path)
    if stderr_target != subprocess.PIPE:
        data = result.stderr
        if data and stderr_target != subprocess.DEVNULL:
            if isinstance(data, str): data = data.encode(kwargs.get('encoding') or 'utf8')
            target = 2 if stderr_target is None else stderr_target if isinstance(stderr_target, int) else stderr_target.fileno()
            while data:
                n = os.write(target, data)
                data = data[n:]
        result.stderr = None
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
    if check:
        result.check_returncode()
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
    with tempfile.TemporaryFile(mode='w+', encoding='utf8') as payload, tempfile.TemporaryDirectory(prefix='bgt-macros-') as macro_dir:
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
                macro_path = os.path.join(macro_dir, 'command-line.h')
                with open(macro_path, 'w', encoding='utf8') as macro:
                    macro.write('#line 1 "<command-line>"\n' + '\n'.join(macros) + '\n')
                # Command-line macros run BEFORE all user -imacros and
                # -include files. This must be the FIRST -imacros input.
                # A real path also makes a missed dependency case harmless to
                # parent-fd reuse; supported outputs are still sanitized below.
                compiler_args = ['-imacros', macro_path] + compiler_args
            compiler_args = args[:prefix] + compiler_args
            check_compiler_budget(compiler_args, env)
            validate_transport_options(args)
            for arg in compiler_args[prefix:]:
                payload.write('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
            transported = compiler_args[:prefix] + ['@' + path]
        else:
            raise ValueError('large argv requires a file transport: ' + args[0])
        payload.flush(); payload.seek(0)
        check_budget(transported, env)
        kwargs['pass_fds'] = (*kwargs.get('pass_fds', ()), *fds)
        return run_compiler(transported, args, macro_path, kwargs)
