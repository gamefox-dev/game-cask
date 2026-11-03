#!/usr/bin/env node
// Original CC0 scale generator; no port/game inputs. Run sequentially in an isolated clone.
import { readFileSync, writeFileSync, mkdirSync, statfsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostname, platform, arch, totalmem, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = resolve(process.env.BGT_BENCH_ROOT ?? '.');
const { buildGame } = await import(pathToFileURL(join(root, 'tools/build/build.mjs')));
const count = Number(process.env.BGT_BENCH_FUNCTIONS ?? 12000);
const id = process.env.BGT_BENCH_ID ?? 'k18-scale-' + count;
if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('invalid benchmark id');
const dir = join(root, 'node_modules/.cache/k18-fixtures', id); mkdirSync(dir, {recursive:true});
const generator = join(root, 'examples/x64-scale/generate.mjs');
const cfg = {id, name:'Original CC0 incremental build benchmark', pipeline:{platform:'win32',
  fixture:{generator:relative(dir,generator), generatorArgs:[count],out:'scale.exe',target:'x86_64-windows-gnu',crt:true,libs:['kernel32']},
  modules:[{from:'./build/scale.exe',main:true}]}};
writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
const reportPath = resolve(process.env.BGT_BENCH_REPORT ?? 'reports/k18/incremental-' + count + '.json');
mkdirSync(resolve(reportPath,'..'),{recursive:true});
const report = {schema:'game-cask/incremental-bench/1',root,count,machine:{hostname:hostname(),platform:platform(),arch:arch(),totalmem:totalmem(),node:process.version},
  revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),samples:[],
  method:'sequential same-clone builds; runtime-only edit appends a comment to bgt_gpu.h, restored byte-exactly; cold means fixture initially absent, not OS/toolchain cold; shared machine, not quiescent'};
function snapshot(){
  const disk=statfsSync(root);
  let memory;
  try { memory=execFileSync('python3',['-I','-c', 'import runpy,json; print(json.dumps({"available_bytes":runpy.run_path('+JSON.stringify(join(root,'tools/harness/pi/shim/memory.py'))+')["available"]()}))'],{encoding:'utf8'}).trim(); } catch(e){memory=String(e);}
  return {at:new Date().toISOString(),loadavg:loadavg(),disk_free_bytes:disk.bavail*disk.bsize,memory};
}
function run(scenario){
 const before=snapshot(),start=performance.now();
 try {
  const manifest=buildGame(dir,{quiet:false});
  report.samples.push({scenario,before,after:snapshot(),wall_ms:performance.now()-start,wasm:manifest.wasm,variants:manifest.variants,modules:manifest.pipeline.modules,metrics:manifest.pipeline.metrics});
 }catch(error){report.samples.push({scenario,before,after:snapshot(),wall_ms:performance.now()-start,error:String(error)});throw error;}
 finally{writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
}
run('cold'); run('no-change');
const header=join(root,'bgt/include/bgt_gpu.h'), original=readFileSync(header);
try {writeFileSync(header,Buffer.concat([original,Buffer.from('\n/* K18 runtime-only rebuild measurement. */\n')]));run('runtime-only-change');}
finally{writeFileSync(header,original);}
console.log('measurement: '+reportPath);
