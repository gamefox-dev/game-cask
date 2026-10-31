// Chunk orchestration only: no instruction emission or guest semantics live here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';

const digest = (b) => createHash('sha256').update(b).digest('hex');
export function partitionFunctions(functions, budget = 32768) {
  if (!Number.isInteger(budget) || budget < 256 || budget > 1000000) throw new Error('chunkInstructions must be 256..1000000');
  const chunks = []; let chunk = [], size = 0;
  for (const f of [...functions].sort((a,b) => a.addr-b.addr)) {
    if (chunk.length && size + f.insns > budget) { chunks.push(chunk); chunk = []; size = 0; }
    chunk.push(f.addr); size += f.insns;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function analyzeCached(tool, file, id, base, dir, identity) {
  const out = join(dir, `analysis_${id}.json`), key = digest(JSON.stringify([identity, digest(readFileSync(tool)), base, id]));
  const start = performance.now();
  const cached = existsSync(out + '.key') && readFileSync(out + '.key','utf8') === key;
  if (!cached) {
    const an = execFileSync(tool, ['analyze',file,'--name',id,'--base',base.toString(16)], {encoding:'utf8',maxBuffer:256<<20});
    writeFileSync(out, an); writeFileSync(out + '.key', key);
  }
  return { analysis: JSON.parse(readFileSync(out,'utf8')), key, analysis_ms: performance.now()-start, analysis_cached: cached };
}

export function liftChunks({ tool, file, id, base, work, analysis, key, selected, skip = [], flagLiveness, budget = 32768 }) {
  const dir = join(work, `chunks_${id}`); mkdirSync(dir, {recursive:true});
  const functions = selected ? analysis.functions.filter((f) => selected.has(f.addr)) : analysis.functions;
  const chunks = partitionFunctions(functions, budget), keep = new Set();
  const tasks = chunks.map((addresses,i) => {
    const name = `${id}_${String(i).padStart(4,'0')}`, out = join(dir, name + '.c'), list = join(dir, name + '.txt');
    writeFileSync(list, addresses.map((a)=>a.toString(16)).join('\n')+'\n');
    for (const p of [out, out+'.key', out+'.stats.json', list]) keep.add(p);
    const args = [tool,'lift',file,'--name',name,'--base',base.toString(16),'--select',list];
    if (flagLiveness) args.push('--flag-liveness','on');
    if (skip.length) args.push('--skip',skip.map((a)=>a.toString(16)).join(','));
    return {out, args, key:digest(JSON.stringify([key,addresses,skip,!!flagLiveness,'chunks-v1']))};
  });
  const metrics = JSON.parse(execFileSync('python3',['-I',join(ROOT,'tools/build/lift.py')], {
    input:JSON.stringify({tasks,jobs:Number(process.env.BGT_BUILD_JOBS ?? 2)}),encoding:'utf8',stdio:['pipe','pipe','inherit'],
  }));
  // Merge only the generated registry, not function bodies. R_* locals stay in their owner's TU.
  const rows = [], declarations = new Set();
  const stats = {functions:0, dataSeeds:analysis.totals.dataSeeds ?? 0, overridden:skip.length,
    specialized:0,generic:0,jumpTables:0,unresolvedJumps:0,flagsElided:0,entries:0};
  let sourceBytes = 0, sourceLines = 0, largest = 0;
  for (const t of tasks) {
    const text = readFileSync(t.out,'utf8');
    const table = text.slice(text.indexOf('const x86_lifted_entry_t x86_lifted_'));
    if (!table.startsWith('const x86_lifted_entry_t')) throw new Error('lifter registry format changed');
    for (const match of table.matchAll(/\{\s*(0x[0-9a-f]+u),\s*(F_[0-9a-f]+),\s*(0x[0-9a-f]+u)\s*\}/g)) {
      rows.push({addr:parseInt(match[1],16), row:`{${match[1]},${match[2]},${match[3]}},`});
      declarations.add(`void ${match[2]}(void);`);
    }
    const s = JSON.parse(readFileSync(t.out+'.stats.json','utf8'));
    for (const k of ['functions','specialized','generic','jumpTables','unresolvedJumps','flagsElided','entries']) stats[k] += s[k] ?? 0;
    const bytes = statSync(t.out).size; sourceBytes += bytes; largest = Math.max(largest,bytes); sourceLines += text.split('\n').length;
  }
  rows.sort((a,b)=>a.addr-b.addr);
  if (rows.length !== stats.entries || new Set(rows.map((r)=>r.addr)).size !== rows.length) throw new Error('chunk registry entry mismatch');
  const registry = join(dir,'registry.c'); keep.add(registry);
  writeFileSync(registry, `#include "x86_lift64.h"\n${[...declarations].join('\n')}\nconst x86_lifted_entry_t x86_lifted_${id}[]={\n${rows.map((r)=>r.row).join('\n')}\n};\n`);
  for (const p of readdirSync(dir)) if (!keep.has(join(dir,p))) rmSync(join(dir,p),{force:true});
  sourceBytes += statSync(registry).size; sourceLines += readFileSync(registry,'utf8').split('\n').length;
  return {sources:[registry,...tasks.map((t)=>t.out)],stats,metrics:{...metrics,generated_c_bytes:sourceBytes,largest_chunk_bytes:largest,generated_lines:sourceLines,chunks:chunks.length}};
}
