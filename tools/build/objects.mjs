// Exact per-translation-unit compiler dependencies. No profile/lifter semantics live here.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from './exec.mjs';
import { ROOT } from './toolchain.mjs';

const digest = (b) => createHash('sha256').update(b).digest('hex');
// Versioned build ABI: UTC Unix epoch, independent of source mtime, host clock,
// TZ and SOURCE_DATE_EPOCH. Explicit definitions also cover clang's __TIMESTAMP__,
// which SOURCE_DATE_EPOCH alone does not pin. Keep these in every compile/probe.
export const PINNED_TIME = Object.freeze({
  version: 'builtin-time-predefinitions-v1',
  __DATE__: 'Jan  1 1970', __TIME__: '00:00:00', __TIMESTAMP__: 'Thu Jan  1 00:00:00 1970',
});
export function hermeticTimeFlags() {
  // Append after caller/response flags; -U also handles caller definitions without
  // a macro-redefined warning. Suppress only the deliberate builtin override.
  return ['-Wno-builtin-macro-redefined', ...Object.entries(PINNED_TIME)
    .filter(([name]) => name !== 'version').flatMap(([name, value]) => ['-U' + name, '-D' + name + '=' + JSON.stringify(value)])];
}
// Paths in keys and __FILE__ must not depend on which clone is building.
export function logicalPath(file, root = ROOT) {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel) ? '@/' + rel.split(sep).join('/') : file;
}
export function cacheDirectory(kind) {
  const base = process.env.BGT_SHARED_CACHE ? resolve(process.env.BGT_SHARED_CACHE, 'bgt-v2') : join(ROOT, 'node_modules/.cache/bgt');
  mkdirSync(base, { recursive: true });
  return join(realpathSync(base), kind);
}
export function portableFlags(flags, root = ROOT) {
  return [...flags, `-ffile-prefix-map=${root}=.`, `-fmacro-prefix-map=${root}=.`];
}
export function objectKey({ compiler, flags, file, dependencies, root = ROOT }) {
  // Preserve lexical path components: clang __FILE__ retains dir/../ spelling.
  // Prefix maps erase only the clone root, not these semantic bytes.
  const pathFlag = (s) => s.startsWith(root + sep) ? '@/' + s.slice(root.length + 1) : s;
  const normalized = flags.map((s, i) => {
    if (['-I', '-isystem', '-iquote', '-idirafter', '-include', '-imacros'].includes(flags[i - 1])) return pathFlag(s);
    for (const prefix of ['-I', '-isystem', '-iquote', '-idirafter']) if (s.startsWith(prefix) && s !== prefix) return prefix + pathFlag(s.slice(prefix.length));
    if (s === `-ffile-prefix-map=${root}=.`) return '-ffile-prefix-map=@=.';
    if (s === `-fmacro-prefix-map=${root}=.`) return '-fmacro-prefix-map=@=.';
    return s; // Macro/string values are semantic bytes, NOT clone paths to rewrite.
  });
  return digest(JSON.stringify(['objects-v2', PINNED_TIME, compiler, normalized, pathFlag(file),
    dependencies.map(([path, hash]) => [logicalPath(path, root), hash]).sort(([a], [b]) => a.localeCompare(b))]));
}
// Expand the unambiguous common GNU response-file form before discovery, keying AND
// compilation. Nested filenames are relative to compiler cwd, not the parent rsp.
// Quoting/escaping/encodings differ between drivers: preserve those argv verbatim and
// bypass caching rather than approximate their tokenizer. The compiler still accepts them.
export function expandResponseFiles(flags, root) {
  const expand = (args, stack = []) => args.flatMap(arg => {
    if (!arg.startsWith('@')) return [arg];
    const file = resolve(root, arg.slice(1));
    if (stack.includes(file) || stack.length >= 32) throw new Error('recursive response file');
    const bytes = readFileSync(file);
    if ([...bytes].some(b => b > 126 || (b < 32 && ![9, 10, 13].includes(b)) || b === 34 || b === 39 || b === 92))
      throw new Error('response-file quoting, escaping or encoding requires compiler tokenization');
    return expand(bytes.toString('ascii').split(/[ \t\r\n]+/).filter(Boolean), [...stack, file]);
  });
  try { return { flags: expand(flags), reason: null }; }
  catch (e) { return { flags, reason: 'response files: ' + e.message }; }
}

// GCC/clang make dependency syntax: escaped whitespace, backslashes and continuation lines.
export function parseDependencies(text) {
  const body = text.replace(/\\\r?\n/g, '').replace(/^[^:]*:\s*/, '');
  const words = []; let word = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) word += body[++i];
    else if (/\s/.test(body[i])) { if (word) words.push(word); word = ''; }
    else if (body[i] === '$' && body[i + 1] === '$') { word += '$'; i++; }
    else word += body[i];
  }
  if (word) words.push(word);
  return [...new Set(words)];
}
function headerNames(dir, seen = new Set()) {
  if (!existsSync(dir)) return [];
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const file = join(dir, e.name);
    if (!existsSync(file)) return [file]; // dangling symlink is still a negative dependency
    return (e.isDirectory() || (e.isSymbolicLink() && statSync(file).isDirectory())) ? [file, ...headerNames(file, seen)] : [file];
  });
}

// Positive depfiles plus directory inventories cover ordinary literal includes.
// Escaping or computed names require the compiler: inventing a partial macro
// evaluator here would turn the optimization into a second, incorrect preprocessor.
function needsCompilerDiscovery(bytes) {
  let text = bytes.toString('utf8');
  if (text.includes('??')) return true; // trigraphs can form directives/line splices
  text = text.replace(/\\\r?\n/g, '');
  if (/\.\.[/\\]/.test(text)) return true;
  // Preserve quoted strings/character literals while removing preprocessing comments.
  text = text.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    s => s.startsWith('/') ? ' ' : s).replace(/%:/g, '#');
  return /^\s*#\s*(?:include(?:_next)?|import)\b[^\S\n]*(?![<"\s])\S/m.test(text) ||
    /__has_include(?:_next)?\s*\(\s*(?![<"\s])\S/.test(text) ||
    /(?:#\s*(?:include(?:_next)?|import)\s*|__has_include(?:_next)?\s*\(\s*)[<"]\//.test(text);
}

export function prepareObjects({ sources, flags, includes, compiler, cache, root = ROOT }) {
  const dependencyDir = join(root, 'node_modules/.cache/bgt/dependencies');
  mkdirSync(dependencyDir, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const hashes = new Map(), compilerDiscovery = new Map(), volatileInputs = new Map();
  // Also fail safe for literal spellings when source pragmas suppress diagnostics.
  const hasVolatileInput = text => /__TIMESTAMP__|__DATE__|__TIME__|Wdate-time|Weverything/.test(text);
  const hash = (f, scanIncludes = true) => {
    if (!hashes.has(f)) {
      const bytes = readFileSync(f);
      hashes.set(f, digest(bytes));
      if (scanIncludes) {
        compilerDiscovery.set(f, needsCompilerDiscovery(bytes));
        volatileInputs.set(f, hasVolatileInput(bytes.toString('utf8')));
      }
    }
    return hashes.get(f);
  };
  const executable = compiler.path.includes(sep) ? compiler.path : process.env.PATH.split(':').map((p) => join(p, compiler.path)).find(existsSync);
  if (!executable) throw new Error(`compiler not found: ${compiler.path}`);
  const prefix = compiler.prefix ?? ['cc'];
  const identity = [compiler.version, hash(realpathSync(executable), false)];
  if (compiler.prefix) identity.push(prefix);
  const expanded = expandResponseFiles(flags, root);
  flags = portableFlags([...expanded.flags, ...hermeticTimeFlags()], root);
  identity.push(PINNED_TIME);
  // Forced includes start in compiler cwd (not the source directory). Let the
  // compiler rediscover these rather than recursively inventory the entire repo.
  const rediscover = !!expanded.reason || flags.some(f => /^-(?:include|imacros)/.test(f));
  // Addition/removal can change include resolution even if every old dependency is unchanged.
  // Contents are deliberately NOT included here: unrelated profile headers cannot invalidate lift objects.
  const searchDirs = [...includes];
  for (let i = 0; i < flags.length; i++) {
    if (['-I', '-isystem', '-iquote', '-idirafter'].includes(flags[i])) searchDirs.push(resolve(root, flags[++i]));
    else for (const prefix of ['-I', '-isystem', '-iquote', '-idirafter']) {
      if (flags[i].startsWith(prefix) && flags[i] !== prefix) { searchDirs.push(resolve(root, flags[i].slice(prefix.length))); break; }
    }
  }
  // Ambient include paths are compiler inputs too, including negative/shadow dependencies.
  const environment = ['CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET']
    .map((name) => [name, process.env[name] ?? '']);
  identity.push(environment);
  for (const name of ['CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH']) {
    if (process.env[name]) searchDirs.push(...process.env[name].split(':').map((p) => resolve(root, p)));
  }
  const names = new Map();
  const inventoryOf = (dir) => { if (!names.has(dir)) names.set(dir, headerNames(dir)); return names.get(dir); };
  return sources.map((file) => {
    // Quoted includes search each including header's directory before -I paths.
    // Inventory their parents too: a newly added sibling can shadow an old -I result.
    const inventory = (dependencies = []) => digest(JSON.stringify([...new Set(
      [...new Set([...searchDirs, dirname(file), ...dependencies.map(([f]) => dirname(f))])].flatMap(inventoryOf),
    )].sort()));
    const manifest = join(dependencyDir, digest(JSON.stringify([file, flags, identity])) + '.json');
    const sourceHash = hash(file);
    let deps, volatile = false;
    try {
      const previous = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!rediscover && typeof previous.volatile === 'boolean' && previous.inventory === inventory(previous.dependencies) && previous.sourceHash === sourceHash &&
          previous.dependencies.every(([f, h]) => existsSync(f) && hash(f) === h) &&
          previous.dependencies.every(([f]) => !compilerDiscovery.get(f))) {
        deps = previous.dependencies; volatile = previous.volatile;
      }
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (!deps) {
      // -M suppresses date-time diagnostics. -E plus a depfile retains the
      // compiler check for any surviving volatile builtin. Predefinitions, not
      // this suppressible diagnostic or a JS macro evaluator, ensure hermeticity.
      const depfile = manifest + '.' + randomUUID() + '.d';
      const discover = (warning) => {
        execFileSync(compiler.path,
          [...prefix, ...flags, '-E', '-MD', '-MF', depfile, '-MT', 'bgt', '-o', '/dev/null', '-Wsystem-headers', warning, file], {
            cwd: root, encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'ignore', 'pipe'],
          });
        return readFileSync(depfile, 'utf8');
      };
      let make;
      try {
        try { make = discover('-Werror=date-time'); }
        catch {
          // Unsupported diagnostics/probes are not evidence of cacheability either.
          // Fall back to ordinary dep discovery; the real compile keeps its flags.
          volatile = true;
          make = execFileSync(compiler.path, [...prefix, ...flags, '-M', '-MT', 'bgt', file], {
            cwd: root, encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'inherit'],
          });
        }
      } finally { rmSync(depfile, { force: true }); }
      deps = [...new Set([file, ...parseDependencies(make).map((f) => resolve(root, f))])].sort().map((f) => [f, hash(f)]);
      const temp = manifest + '.' + process.pid + '.tmp';
      writeFileSync(temp, JSON.stringify({ inventory: inventory(deps), sourceHash, dependencies: deps, volatile })); renameSync(temp, manifest);
    }
    volatile ||= deps.some(([f]) => volatileInputs.get(f)) || expanded.flags.some(f => hasVolatileInput(f) || f === '-w' || f === '-Wno-everything' || f === '-Wno-date-time');
    // Retain conservative detection/bypass as defence in depth, but correctness
    // does not rely on recognizing source spellings or unsuppressible warnings.
    const uncacheable = expanded.reason || (volatile ? 'volatile date/time input or unsupported dependency probe' : null);
    const key = objectKey({ compiler: identity, flags, file, dependencies: deps, root }) +
      (expanded.reason ? '-' + randomUUID() : '');
    const out = join(cache, key + '.o');
    // Diagnostic history only: never used to decide validity or choose a key.
    const history = join(dependencyDir, digest(file) + '.last.json');
    const current = { compiler: identity, flags, sourceHash, dependencies: deps, key };
    let previous;
    try { previous = JSON.parse(readFileSync(history, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    const reasons = [];
    if (uncacheable) reasons.push({ input: 'uncacheable', detail: uncacheable });
    if (!existsSync(out)) {
      if (!previous) reasons.push({ input: 'cold', detail: 'no previous input snapshot' });
      else {
        for (const input of ['compiler', 'flags']) if (JSON.stringify(previous[input]) !== JSON.stringify(current[input])) reasons.push({ input });
        if (previous.sourceHash !== sourceHash) reasons.push({ input: 'source', path: logicalPath(file, root) });
        const before = new Map(previous.dependencies), after = new Map(deps);
        for (const path of new Set([...before.keys(), ...after.keys()])) if (path !== file && before.get(path) !== after.get(path))
          reasons.push({ input: 'header', path: logicalPath(path, root), change: !before.has(path) ? 'added' : !after.has(path) ? 'removed' : 'content' });
        if (!reasons.length) reasons.push({ input: 'payload', detail: 'not present (evicted, interrupted or never compiled)' });
      }
    }
    const temp = history + '.' + process.pid + '.tmp';
    writeFileSync(temp, JSON.stringify(current)); renameSync(temp, history);
    return { out, cwd: root, cacheable: !uncacheable, volatile_inputs_detected: volatile, source: logicalPath(file, root), miss_reasons: reasons,
      args: [compiler.path, ...prefix, ...flags, '-c', file] };
  });
}
