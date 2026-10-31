// Architecture-aware import census over the runtime's actual dispatch tables.
// The C preprocessor expands the same include files, width expressions and registry macros.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';
import { isProfileDll, x86tool } from '../build/pipeline.mjs';

const dir = join(ROOT, 'platforms/win32');
export function crtRegistry() {
  const source = readFileSync(join(dir, 'crt.def'), 'utf8');
  return [...source.matchAll(/CRT\("([^"]+)",\s*"([^"]+)",\s*(\w+)\)/g)]
    .map((m) => ({ name: m[1], group: m[2], status: m[3] === '0' ? 'stub' : 'implemented' }));
}
const cache = new Map();
function table(source, name) {
  const start = source.indexOf(`${name}[] = {`);
  if (start < 0) throw new Error(`runtime registry table not found: ${name}`);
  const begin = source.indexOf('{', start) + 1, end = source.indexOf('\n};', begin);
  if (end < 0) throw new Error(`unterminated runtime registry: ${name}`);
  return source.slice(begin, end);
}
export function runtimeRegistry(machine = 'x86-64') {
  const wide = machine === 'x86-64';
  const files = readdirSync(dir).filter((f) => /\.(c|h|def)$/.test(f));
  const sources = new Map(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  const identity = `${machine}\0${[...sources.values()].join('\0')}`;
  if (cache.has(identity)) return cache.get(identity);
  const core = sources.get('w32_core.c');
  // This is the complete ordered list consumed by w32_find_api, not a second inventory.
  const registration = core.match(/\*tabs\[\d+\]\s*=\s*\{([^}]+)\}/);
  if (!registration) throw new Error('unrecognized runtime table registration (update census)');
  const names = registration[1].match(/w32_api_\w+/g);
  const bodies = names.map((name) => {
    const source = [...sources.values()].find((s) => s.includes(`${name}[] = {`));
    if (!source) throw new Error(`unresolved runtime table ${name}`);
    return table(source, name);
  });
  const definitions = `
#define W32_64 ${wide ? 1 : 0}
#define API(n, ...) ENTRY(n, "implemented")
#define CAPI(n, ...) ENTRY(n, "implemented")
#define FAPI(n, ...) ENTRY(n, "failure-only")
#define TF(n, ...) ENTRY(n, "failure-only")
#define DATAI(n) ENTRY(n, "implemented")
#define STUB(n, ...) ENTRY(n, "stub")
#define CSTUB(n) ENTRY(n, "stub")
#define GLSTUB(n, ...) ENTRY(n, "stub")
#define T(n, ...) ENTRY(n, "implemented")
#define T64(n, ...) ENTRY(n, "implemented")
#define C(n, ...) ENTRY(n, "implemented")
`;
  const snippets = [table(sources.get('w32_thread.c'), 'api'), ...bodies];
  const preprocessed = execFileSync(process.env.CC || 'cc', ['-E', '-P', '-x', 'c', '-I', dir, '-'], {
    input: definitions + snippets.map((s, i) => `GROUP(${i})\n${s}`).join('\n'), encoding: 'utf8',
  });
  const entries = [];
  let group;
  for (const match of preprocessed.matchAll(/GROUP\((\d+)\)|ENTRY\("([^"]+)",\s*"([^"]+)"\)/g)) {
    if (match[1] !== undefined) group = +match[1] === 0 ? 'threads' : names[+match[1] - 1].slice(8);
    else entries.push({ name: match[2], status: match[3] === 'failure-only' ? 'implemented' : match[3],
      ...(match[3] === 'failure-only' ? { capability: 'failure-only' } : {}), group, insensitive: group === 'threads' });
  }
  if (wide) {
    // thunk_handler: threads > CRT > w64_api > shared tables. w64_api compares case-insensitively.
    const crt = crtRegistry();
    const data = [...sources.get('crt.def').matchAll(/DATA\("([^"]+)"\)/g)]
      .map((m) => ({ name: m[1], status: 'implemented', group: 'startup-data' }));
    const source = sources.get('w32_x64.c');
    const special = [...source.matchAll(/\{"([^"]+)",\w+\}|w32_streqi\(name,"([^"]+)"\)/g)]
      .map((m) => ({ name: m[1] || m[2], status: 'implemented', group: 'win64', insensitive: true }));
    const split = entries.findIndex((e) => e.group !== 'threads');
    entries.splice(split, 0, ...crt, ...data, ...special);
  }
  cache.clear(); // retain one current source identity, not copies after every edit
  cache.set(identity, entries);
  return entries;
}
export function importStatus(name, dll, machine = 'x86-64') {
  if (!isProfileDll(dll)) return { status: 'unknown', group: null };
  // Runtime currently uses one global symbol namespace after checking the DLL is registered.
  // Do not pretend to offer stricter DLL isolation than GetProcAddress/runtime dispatch.
  const found = runtimeRegistry(machine).find((e) => e.insensitive
    ? e.name.toLowerCase() === name.toLowerCase() : e.name === name);
  return found ? { status: found.status, group: found.group,
    ...(found.capability ? { capability: found.capability } : {}) } : { status: 'unknown', group: null };
}
export function importsCoverage(file) {
  const pe = JSON.parse(execFileSync(x86tool(), ['analyze', file], { encoding: 'utf8', maxBuffer: 256 << 20 }));
  const imports = pe.imports.map(({ dll, name }) => ({ dll, name, ...importStatus(name, dll, pe.machine) }));
  const totals = { implemented: 0, stub: 0, unknown: 0 };
  for (const i of imports) totals[i.status]++;
  return { schema: 'game-cask/imports-coverage/1', machine: pe.machine, imports, totals };
}
