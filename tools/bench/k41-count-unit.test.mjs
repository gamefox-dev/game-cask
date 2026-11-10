// Original CC0-1.0. Analytically known workloads test the instrumentation, not its optimizer.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {instrumentWat} from './k41-wasm-count.mjs';
const scratch=process.env.BGT_TRIAL_SCRATCH;
if(!scratch)throw Error('set BGT_TRIAL_SCRATCH');
async function build(source,native=true,imports={}){
 const dir=mkdtempSync(join(scratch,'counter-unit-'));
 const {wat,...meta}=instrumentWat(source,{native});writeFileSync(join(dir,'count.wat'),wat);
 const assemble=(name)=>execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-as',join(dir,name+'.wat'),'--all-features','--disable-compact-imports','-o',join(dir,name+'.wasm')]);
 assemble('count');writeFileSync(join(dir,'original.wat'),source);assemble('original');
 const instantiate=async n=>(await WebAssembly.instantiate(readFileSync(join(dir,n+'.wasm')),imports)).instance.exports;
 const counted=await instantiate('count'),original=await instantiate('original');
 return {counted,original,meta,count:k=>Number(counted['k39_'+k]?.value??0n)};
}
test('known 3-iteration loop, calls, fallthrough and explicit returns, original locals only',async()=>{
 const {counted:c,original:o,count:n}=await build('(module (type $t (func (param i32) (result i32))) (export "run" (func $run)) (func $leaf (param $x i32) (result i32) (return (i32.add (local.get $x) (i32.const 1)))) (func $run (result i32) (local $i i32) (local.set $i (i32.const 3)) (loop $l (drop (call $leaf (local.get $i))) (br_if $l (local.tee $i (i32.sub (local.get $i) (i32.const 1))))) (local.get $i)) ;; producers\n)'.replace('\\n','\n'));
 assert.equal(c.run(),o.run());
 assert.equal(n('native.entries'),4);assert.equal(n('native.exits'),4);assert.equal(n('native.call.native'),3);
 assert.equal(n('native.op.return'),3);assert.equal(n('native.op.loop'),3);assert.equal(n('native.op.br_if'),3);
 assert.equal(n('native.op.i32.add'),3);assert.equal(n('native.op.i32.sub'),3);
 assert.equal(n('native.op.local.get'),10);assert.equal(n('native.op.local.set'),1);assert.equal(n('native.op.local.tee'),3);
});
test('guest/host separation, once-only EA evaluation, offsets, precomputed local EA, 32/64 conversions',async()=>{
 const {counted:c,original:o,count:n}=await build('(module (memory $m 2) (data (i32.const 0) "\\00\\00\\01\\00") (export "run" (func $N_t)) (export "memory" (memory $m)) (func $x86_map (result i32) (i32.load (i32.const 0))) (func $N_t (result i64) (local $p i32) (local.set $p (i32.add (i32.const 65520) (i32.const 16))) (i32.store offset=4 (local.get $p) (i32.const 7)) (i32.store offset=8 (i32.const 0) (i32.load offset=4 (local.get $p))) (i64.add (i64.extend_i32_u (i32.load offset=8 (i32.const 0))) (i64.shl (i64.const 1) (i64.const 3)))))'.replaceAll('\\\\','\\'),false);
 assert.equal(c.run(),o.run());assert.equal(c.run(),15n);
 assert.deepEqual(new Uint8Array(c.memory.buffer),new Uint8Array(o.memory.buffer));
 assert.equal(n('lifted.memory.guest.load'),2);assert.equal(n('lifted.memory.guest.store'),2);
 assert.equal(n('lifted.memory.host.load'),2);assert.equal(n('lifted.memory.host.store'),2);
 assert.equal(n('lifted.op.i32.add'),2);assert.equal(n('lifted.address.precomputed_candidate.i32.add'),2);
 assert.equal(n('lifted.op.i64.extend_i32_u'),2);assert.equal(n('lifted.op.i64.add'),2);assert.equal(n('lifted.op.i64.shl'),2);
});
test('typed select/if, br_table, bare br, imported call and call_indirect signature',async()=>{
 const source='(module (type $t (func (param i32) (result i32))) (import "m" "f" (func $import (param $x i32) (result i32))) (table $tab 1 funcref) (elem (i32.const 0) $leaf) (export "run" (func $run)) (func $leaf (param $x i32) (result i32) (call $import (local.get $x))) (func $run (param $x i32) (result i32) (block $out (block $inner (br_table $inner $out (local.get $x))) (br $out)) (if (result i32) (local.get $x) (then (call_indirect (type $t) (select (i32.const 4) (i32.const 5) (local.get $x)) (i32.const 0))) (else (i32.wrap_i64 (i64.const 7))))))';
 const {counted:c,original:o,count:n}=await build(source,true,{m:{f:x=>x+10}});
 assert.equal(c.run(0),o.run(0));assert.equal(c.run(1),o.run(1));
 assert.equal(n('native.entries'),3);assert.equal(n('native.exits'),3);
 assert.equal(n('native.op.br_table'),2);assert.equal(n('native.op.br'),1);
 assert.equal(n('native.op.if'),2);assert.equal(n('native.call.indirect'),1);assert.equal(n('native.call.native'),1);
 assert.equal(n('native.op.select'),1);assert.equal(n('native.op.i32.wrap_i64'),1);
});
test('side-effecting EA evaluated once; signed/zero 64-bit comparisons return i32',async()=>{
 const source="(module (memory $m 2) (data (i32.const 0) \"\\00\\00\\01\\00\") (global $visits (mut i32) (i32.const 0)) (export \"visits\" (global $visits)) (export \"run\" (func $N_t)) (func $x86_map (result i32) (i32.load (i32.const 0))) (func $address (result i32) (global.set $visits (i32.add (global.get $visits) (i32.const 1))) (i32.const 65536)) (func $N_t (result i32) (i32.store offset=4 (call $address) (i32.const 7)) (i32.and (i64.lt_s (i64.const -1) (i64.const 0)) (i64.eqz (i64.const 0)))))";
 const {counted:c,original:o,count:n}=await build(source,false);
 assert.equal(c.run(),o.run());assert.equal(c.visits.value,1);assert.equal(o.visits.value,1);
 assert.equal(n('lifted.memory.guest.store'),1);assert.equal(n('lifted.call.runtime'),1);
 assert.equal(n('lifted.op.i64.lt_s'),1);assert.equal(n('lifted.op.i64.eqz'),1);
});

test('source-attributed operators count their own location, not the last child location',async()=>{
 const source=['(module (export "run" (func $run)) (func $run (param $x i32) (result i32)', ';;@ form-add_r32_r32:1:0', '(i32.add', ';;@ form-mov_r32_r32:1:0', '(local.get $x) (i32.const 7))))'].join(String.fromCharCode(10));
 const {counted:c,original:o,count:n}=await build(source);
 assert.equal(c.run(9),o.run(9));
 assert.equal(n('add_r32_r32.op.i32.add'),1);assert.equal(n('mov_r32_r32.op.local.get'),1);assert.equal(n('mov_r32_r32.op.i32.const'),1);
 assert.equal(n('native.op.i32.add'),1);assert.equal(n('mov_r32_r32.op.i32.add'),0);
});
