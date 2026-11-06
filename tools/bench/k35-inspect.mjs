// Original CC0-1.0. Static wasm operation inventory and sustained self-sample ranking.
// node tools/bench/k35-inspect.mjs /path/to/k35-profile
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const c = readFileSync(join(dir, 'lifted.c'), 'utf8');
const wat = readFileSync(join(dir, 'jspi.wat'), 'utf8');
const functions = wat.split(/(?=^ \(func )/m).filter(s => s.startsWith(' (func '));
const opCounts = s => {
  const out = {};
  for (const [, op] of s.matchAll(/\(([a-z][\w.]*)/g)) {
    if (['func', 'local', 'param', 'result', 'type', 'export', 'import', 'data', 'elem'].includes(op)) continue;
    out[op] = (out[op] ?? 0) + 1;
  }
  return out;
};
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const profiles = Object.fromEntries(['asyncify','jspi'].map(mode => {
  const p = JSON.parse(readFileSync(join(dir, mode + '.cpuprofile'), 'utf8'));
  const nodes = new Map(p.nodes.map(n => [n.id,n]));
  const counts = {};
  for (const id of p.samples) { const name = nodes.get(id).callFrame.functionName; counts[name] = (counts[name] ?? 0) + 1; }
  return [mode, { samples: p.samples.length, counts }];
}));
const rows = [];
for (const body of functions) {
  const name = /^ \(func \$([^ ]+)/.exec(body)?.[1];
  if (!name) continue;
  const counts = opCounts(body);
  if (!name.startsWith('R_') && !['xl_pointer','xs_parity','xl_imul'].includes(name)) continue;
  const start = c.indexOf('void ' + name + '(uint32_t pc){');
  const rest = c.slice(start);
  const next = /\n(?:static [^\n]*void R_|void N_)/.exec(rest);
  const emitted = start < 0 ? '' : rest.slice(0, next?.index ?? rest.length);
  const guest = [...emitted.matchAll(/^(?:L|N)_[0-9a-f]+:/gm)].length;
  const sumIf = f => Object.entries(counts).reduce((n,[k,v]) => n + (f(k) ? v : 0),0);
  const row = { name, guest, total: sum(counts), ops_per_static_guest: guest ? sum(counts)/guest : null,
    loads: sumIf(k => k.includes('.load')), stores: sumIf(k => k.includes('.store')),
    locals: sumIf(k => k.startsWith('local.')), calls: counts.call ?? 0,
    branches: sumIf(k => ['br','br_if','br_table','if','loop','return'].includes(k)), switches: counts.br_table ?? 0,
    self_samples: Object.fromEntries(Object.entries(profiles).map(([m,p]) => [m,p.counts[name] ?? 0])), counts };
  rows.push(row);
}
rows.sort((a,b) => b.self_samples.jspi - a.self_samples.jspi);
const out = { method: 'All counts are static wasm operators, including const/local/control operators; function/local declarations excluded. Includes cold replay/landing/entry paths: not dynamically retired operations, CPU cycles or spill counts. Profiles exclude 100 warmup updates; 10000 sustained updates at 100us. Profile0; named artifacts separate from uninstrumented timing.', profiles, rows };
writeFileSync(join(dir,'operations.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({profiles:Object.fromEntries(Object.entries(profiles).map(([m,p])=>[m,p.samples])),rows:rows.slice(0,12).map(row => { const {counts: _counts, ...rest} = row; return rest; })},null,2));
