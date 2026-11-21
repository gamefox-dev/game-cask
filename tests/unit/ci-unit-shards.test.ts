// @bgt-examples: none
// The required CI shards must never hide inventory drift or omit newly added tests.
import {it, expect} from 'vitest';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {ROOT} from '../support/headless';

const scale='tests/unit/build-chunks.test.ts';
const files=['tests/unit/a.test.ts','tests/unit/b.test.ts','tests/oracle/tooling.test.ts'];
function fixture(drift=false,sharedExample=false,extraFiles:string[]=[]) {
  const discovered=[...files,...extraFiles];
  const dir=mkdtempSync(join(tmpdir(),'bgt-ci-inventory-'));
  for(const path of ['tools/build','node_modules/vitest','tests/unit','tests/oracle','examples/x86-heap'])mkdirSync(join(dir,path),{recursive:true});
  for(const name of ['ci-unit-shards.mjs','test-examples.mjs','toolchain.mjs'])cpSync(join(ROOT,'tools/build',name),join(dir,'tools/build',name));
  writeFileSync(join(dir,'.zig-version'),'0.13.0');
  writeFileSync(join(dir,'examples/x86-heap/game.json'),'{}');
  for(const file of discovered){mkdirSync(dirname(join(dir,file)),{recursive:true});writeFileSync(join(dir,file),sharedExample&&file.includes('/unit/')?'// @bgt-examples: x86-heap':'// @bgt-examples: none');}
  writeFileSync(join(dir,'vitest.config.ts'),'// inventory fixture only');
  writeFileSync(join(dir,scale),'// scale is covered by its required job');
  // Fake only discovery output, never a build/test success stub. The real helper
  // still runs Node and verifies the same inventory and shard-union contracts.
  writeFileSync(join(dir,'node_modules/vitest/vitest.mjs'),
    'import {fileURLToPath} from "node:url";const root=new URL("../../",import.meta.url);const files=(process.env.BGT_CI_LIGHT===' + JSON.stringify('1') + '?' + JSON.stringify(drift?discovered.slice(1):discovered) + ':' + JSON.stringify([...discovered,scale]) + ');console.log(JSON.stringify(files.map(file=>({file:fileURLToPath(new URL(file,root))}))));');
  return dir;
}

it('deterministically partitions every discovered file exactly once plus the required scale file',()=>{
  const dir=fixture();
  try {
    const list=(shard:string)=>execFileSync(process.execPath,[join(dir,'tools/build/ci-unit-shards.mjs'),shard],{encoding:'utf8'}).trim().split('\n');
    const a=list('1/2'),b=list('2/2');
    expect(a).toEqual(list('1/2'));
    expect(a.length).toBeGreaterThan(0);expect(b.length).toBeGreaterThan(0);
    expect([...a,...b].sort()).toEqual([...files].sort());
    expect(new Set([...a,...b]).size).toBe(files.length);
    expect([...a,...b]).not.toContain(scale);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

it('retains every configured file regardless of directory, extension or naming convention',()=>{
  // A new default-config include must not disappear from BOTH discovery sets,
  // making a filtered union falsely look complete. Opt-in configs stay separate.
  const added=['tools/bench/configured.test.ts','tests/integration/new.spec.mjs'];
  const dir=fixture(false,false,added);
  try {
    const list=(shard:string)=>execFileSync(process.execPath,[join(dir,'tools/build/ci-unit-shards.mjs'),shard],{encoding:'utf8'}).trim().split('\n');
    const union=[...list('1/2'),...list('2/2')];
    expect(union.sort()).toEqual([...files,...added].sort());
    expect(new Set(union).size).toBe(files.length+added.length);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

it('partitions the measured inventory into four bounded CI shards',()=>{
  const extra=['tests/unit/c.test.ts'],dir=fixture(false,false,extra),all=[...files,...extra];
  try {
    const shards=[1,2,3,4].map(i=>execFileSync(process.execPath,[join(dir,'tools/build/ci-unit-shards.mjs'),i+'/4'],{encoding:'utf8'}).trim().split('\n'));
    for(const shard of shards)expect(shard.filter(Boolean).length).toBeGreaterThan(0); // an empty shard would run npm test unfiltered
    expect(shards.flat().sort()).toEqual([...all].sort());
    expect(new Set(shards.flat()).size).toBe(all.length);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

it('accounts for cold setup and keeps tests sharing an expensive prebuild together',()=>{
  const dir=fixture(false,true);
  try {
    const list=(shard:string)=>execFileSync(process.execPath,[join(dir,'tools/build/ci-unit-shards.mjs'),shard],{encoding:'utf8'}).trim().split('\n');
    const shards=[list('1/2'),list('2/2')];
    expect(shards.some(s=>s.includes(files[0])&&s.includes(files[1]))).toBe(true);
    expect(shards.flat().sort()).toEqual([...files].sort());
  }finally{rmSync(dir,{recursive:true,force:true});}
});

it('requires every unit shard to succeed in the actual aggregate gate',()=>{
  const workflow=readFileSync(join(ROOT,'.github/workflows/ci.yml'),'utf8');
  const start=workflow.indexOf('\n  gate:');
  // workflow_dispatch.inputs.webgpu appears before jobs; only the later job
  // terminates this block. Keep running the actual gate script below.
  const end=workflow.indexOf('\n  webgpu:',start);
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  const gate=workflow.slice(start,end);
  const script=gate.split('        run: |\n')[1].trim();
  // I17: four shards (K50/K51/K53 pushed three past the 60-min job limit); each one must gate.
  const ok={LINT_JS:'success',LINT_NATIVE:'success',LINT_EXAMPLES:'success',UNIT1:'success',UNIT2:'success',UNIT3:'success',UNIT4:'success',E2E:'success',SCALE:'success'};
  expect(spawnSync('bash',['-e','-c',script],{env:{...process.env,...ok},encoding:'utf8'}).status).toBe(0);
  for(const n of [1,2,3,4]){
    expect(gate).toMatch(new RegExp('needs: \\[.*unit_'+n+'[,\\]]'));
    expect(gate).toContain('UNIT'+n+': ${{ needs.unit_'+n+'.result }}');
    expect(workflow).toContain('ci-unit-shards.mjs '+n+'/4');
    for(const bad of ['failure','cancelled','skipped']){
      const result=spawnSync('bash',['-e','-c',script],{env:{...process.env,...ok,['UNIT'+n]:bad},encoding:'utf8'});
      expect(result.status,'UNIT'+n+'='+bad).toBe(1);
    }
  }
});

it('fails closed on inventory drift before CI starts npm test',()=>{
  const dir=fixture(true),marker=join(dir,'ran-tests');
  try {
    // Run each actual workflow inventory command under bash -e. Process
    // substitution would swallow Node's exit status and create the marker.
    const workflow=readFileSync(join(ROOT,'.github/workflows/ci.yml'),'utf8');
    const commands=workflow.split('\n').filter(line=>line.includes('node tools/build/ci-unit-shards.mjs')).map(line=>line.trim());
    expect(commands).toHaveLength(4);
    for(const command of commands){
      const result=spawnSync('bash',['-e','-c',command+'\ntouch "'+marker+'"'],{cwd:dir,env:{...process.env,RUNNER_TEMP:dir},encoding:'utf8'});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('CI unit partition drift');
      expect(existsSync(marker)).toBe(false);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
