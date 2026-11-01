// Exact per-translation-unit compiler dependencies. No profile/lifter semantics live here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from './exec.mjs';
import { ROOT } from './toolchain.mjs';

const digest = (b) => createHash('sha256').update(b).digest('hex');
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
  const pathFlag = (s) => isAbsolute(s) ? logicalPath(s, root) : s;
  const normalized = flags.map((s, i) => {
    if (['-I', '-isystem', '-iquote', '-idirafter', '-include', '-imacros'].includes(flags[i - 1])) return pathFlag(s);
    for (const prefix of ['-I', '-isystem', '-iquote', '-idirafter']) if (s.startsWith(prefix) && s !== prefix) return prefix + pathFlag(s.slice(prefix.length));
    if (s === `-ffile-prefix-map=${root}=.`) return '-ffile-prefix-map=@=.';
    if (s === `-fmacro-prefix-map=${root}=.`) return '-fmacro-prefix-map=@=.';
    return s; // Macro/string values are semantic bytes, NOT clone paths to rewrite.
  });
  return digest(JSON.stringify(['objects-v2', compiler, normalized, logicalPath(file, root),
    dependencies.map(([path, hash]) => [logicalPath(path, root), hash]).sort(([a], [b]) => a.localeCompare(b))]));
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

export function prepareObjects({ sources, flags, includes, compiler, cache, root = ROOT }) {
  const dependencyDir = join(root, 'node_modules/.cache/bgt/dependencies');
  mkdirSync(dependencyDir, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const hashes = new Map();
  const hash = (f) => { if (!hashes.has(f)) hashes.set(f, digest(readFileSync(f))); return hashes.get(f); };
  const executable = compiler.path.includes(sep) ? compiler.path : process.env.PATH.split(':').map((p) => join(p, compiler.path)).find(existsSync);
  if (!executable) throw new Error(`compiler not found: ${compiler.path}`);
  const identity = [compiler.version, hash(realpathSync(executable))];
  flags = portableFlags(flags, root);
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
  const environment = ['CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'SOURCE_DATE_EPOCH']
    .map((name) => [name, process.env[name] ?? '']);
  identity.push(environment);
  for (const name of ['CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH']) {
    if (process.env[name]) searchDirs.push(...process.env[name].split(':').map((p) => resolve(root, p)));
  }
  const names = new Map();
  const inventoryOf = (dir) => { if (!names.has(dir)) names.set(dir, headerNames(dir)); return names.get(dir); };
  return sources.map((file) => {
    const inventory = digest(JSON.stringify([...new Set([...searchDirs, dirname(file)].flatMap(inventoryOf))].sort()));
    const manifest = join(dependencyDir, digest(JSON.stringify([file, flags, identity])) + '.json');
    const sourceHash = hash(file);
    let deps;
    try {
      const previous = JSON.parse(readFileSync(manifest, 'utf8'));
      if (previous.inventory === inventory && previous.sourceHash === sourceHash &&
          previous.dependencies.every(([f, h]) => existsSync(f) && hash(f) === h)) deps = previous.dependencies;
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (!deps) {
      const make = execFileSync(compiler.path, ['cc', ...flags, '-M', '-MT', 'bgt', file], {
        cwd: root, encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'inherit'],
      });
      deps = [...new Set([file, ...parseDependencies(make).map((f) => resolve(root, f))])].sort().map((f) => [f, hash(f)]);
      const temp = manifest + '.' + process.pid + '.tmp';
      writeFileSync(temp, JSON.stringify({ inventory, sourceHash, dependencies: deps })); renameSync(temp, manifest);
    }
    const key = objectKey({ compiler: identity, flags, file, dependencies: deps, root });
    return { out: join(cache, key + '.o'), args: [compiler.path, 'cc', ...flags, '-c', file] };
  });
}
