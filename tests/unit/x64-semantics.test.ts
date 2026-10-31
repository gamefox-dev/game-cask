import {beforeAll,it,expect} from 'vitest';
import {compileC} from '../support/compile';
let ex:any,dv:DataView;
beforeAll(async()=>{const result=await WebAssembly.instantiate(await compileC('tests/fixtures/c/x64_semantics.c', [], true));ex=result.instance.exports;dv=new DataView(ex.memory.buffer);});
function reset(){ex.reset();}
function reg(i:number,v?:bigint){const o=ex.regs()+i*8;if(v!==undefined)dv.setBigUint64(o,BigInt.asUintN(64,v),true);return dv.getBigUint64(o,true);}
function vec(i:number,v:number[],type='u32'){const o=ex.vectors()+i*16;if(type==='f64'){v.forEach((n,k)=>dv.setFloat64(o+8*k,n,true));}else if(type==='f32'){v.forEach((n,k)=>dv.setFloat32(o+4*k,n,true));}else v.forEach((n,k)=>dv.setUint32(o+4*k,n,true));}
function words(i:number){return Array.from({length:4},(_,k)=>dv.getUint32(ex.vectors()+i*16+k*4,true));}
function floats(i:number,double=false){return Array.from({length:double?2:4},(_,k)=>double?dv.getFloat64(ex.vectors()+i*16+k*8,true):dv.getFloat32(ex.vectors()+i*16+k*4,true));}
function run(hex:string){const b=Buffer.from(hex,'hex');new Uint8Array(ex.memory.buffer,ex.bytes(),b.length).set(b);expect(ex.run(b.length)).toBe(b.length);}
it('REX 16 GPRs, zero extension, partial/high bytes, RIP and 32-bit address wrapping',()=>{
 reset();reg(8,0x123456789abcdef0n);run('4d89c1');expect(reg(9)).toBe(0x123456789abcdef0n);
 run('4589c1');expect(reg(9)).toBe(0x9abcdef0n);reg(0,0x1122334455667788n);run('b4aa');expect(reg(0)).toBe(0x112233445566aa88n);
 reg(4,0x123400n);run('40b455');expect(reg(4)).toBe(0x123455n);
 run('488d050c000000');expect(reg(0)).toBe(0x1013n);reg(0,0xffffffffn);run('8d4802');expect(reg(1)).toBe(1n);
 reg(0,0x100002000n);dv.setUint32(ex.memory_bytes()+0x2000,0x78563412,true);run('678b00');expect(reg(0)).toBe(0x78563412n);
});
it('64-bit ALU/carry/overflow, multiply, bit scans/tests, CMOV/SET and LOCK operations',()=>{
 reset();reg(0,0xffffffffffffffffn);reg(1,1n);run('4801c8');expect(reg(0)).toBe(0n);expect(ex.flags()&0x41).toBe(0x41);
 reg(0,0x7fffffffffffffffn);run('4883c001');expect(reg(0)).toBe(0x8000000000000000n);expect(ex.flags()&0x800).toBe(0x800);
 reg(0,0x100000002n);reg(1,3n);run('480fafc1');expect(reg(0)).toBe(0x300000006n);
 reg(0,1n<<57n);run('480fbcc8');expect(reg(1)).toBe(57n);run('480fbdc8');expect(reg(1)).toBe(57n);
 reg(1,57n);run('480fa3c8');expect(ex.flags()&1).toBe(1);run('0f92c2');expect(reg(2)&255n).toBe(1n);
 ex.set_flags(0x40);reg(1,0x1122334455667788n);run('480f44c1');expect(reg(0)).toBe(reg(1));
 reg(3,0x2000n);dv.setBigUint64(ex.memory_bytes()+0x2000,9n,true);reg(0,9n);reg(1,12n);run('f0480fb10b');expect(dv.getBigUint64(ex.memory_bytes()+0x2000,true)).toBe(12n);
 reg(11,0x2000n);reg(0,1n);reg(2,2n);reg(3,3n);reg(1,4n);dv.setBigUint64(ex.memory_bytes()+0x2000,1n,true);dv.setBigUint64(ex.memory_bytes()+0x2008,2n,true);run('f0490fc70b');expect(ex.flags()&0x40).toBe(0x40);expect(dv.getBigUint64(ex.memory_bytes()+0x2000,true)).toBe(3n);expect(dv.getBigUint64(ex.memory_bytes()+0x2008,true)).toBe(4n);
});
it('REX.W string move/store and address registers preserve qword data',()=>{
 reset();reg(6,0x2000n);reg(7,0x2100n);reg(1,2n);dv.setBigUint64(ex.memory_bytes()+0x2000,0xfedcba9876543210n,true);dv.setBigUint64(ex.memory_bytes()+0x2008,7n,true);
 run('f348a5');expect(dv.getBigUint64(ex.memory_bytes()+0x2100,true)).toBe(0xfedcba9876543210n);expect(dv.getBigUint64(ex.memory_bytes()+0x2108,true)).toBe(7n);expect(reg(6)).toBe(0x2010n);expect(reg(1)).toBe(0n);
});
it('SSE2 packed/scalar arithmetic, comparison, shuffle, unpack and integer lanes',()=>{
 reset();vec(0,[2,4],'f64');vec(1,[5,3],'f64');run('660f59c1');expect(floats(0,true)).toEqual([10,12]);run('660f58c1');expect(floats(0,true)).toEqual([15,15]);
 vec(0,[1,2,3,4],'f32');vec(1,[10,20,30,40],'f32');run('f30f58c1');expect(floats(0)).toEqual([11,2,3,4]);
 run('0fc6c11b');expect(floats(0)).toEqual([4,3,20,10]);run('0f14c1');expect(floats(0)).toEqual([4,10,3,20]);
 vec(0,[1,2,3,4]);vec(1,[10,20,30,40]);run('660ffec1');expect(words(0)).toEqual([11,22,33,44]);run('660f70c01b');expect(words(0)).toEqual([44,33,22,11]);
 vec(0,[1,2,3,4],'f32');vec(1,[2,2,1,4],'f32');run('0fc2c101');expect(words(0)).toEqual([0xffffffff,0,0,0]);
});
it('MOVD/Q and scalar moves, conversions and logic preserve the specified lanes',()=>{
 reset();reg(0,0xfedcba9876543210n);run('66480f6ec0');expect(words(0)).toEqual([0x76543210,0xfedcba98,0,0]);run('66480f7ec1');expect(reg(1)).toBe(reg(0));
 vec(0,[9,8,7,6],'f32');vec(1,[2,3,4,5],'f32');run('f30f10c1');expect(floats(0)).toEqual([2,8,7,6]);run('0f57c1');expect(words(0)[0]).toBe(0);
 reg(0,0x100000001n);run('f2480f2ac0');expect(floats(0,true)[0]).toBe(4294967297);run('f2480f2cc8');expect(reg(1)).toBe(0x100000001n);
 vec(1,[2.5,0],'f64');run('f2480f2dc1');expect(reg(0)).toBe(2n);vec(1,[3.5,0],'f64');run('f2480f2dc1');expect(reg(0)).toBe(4n);
 vec(1,[NaN,1],'f64');run('660f2ec1');expect(ex.flags()&0x45).toBe(0x45);
});
it('SSE moves cover aligned/unaligned memory, scalar zeroing, high XMM registers and preserved lanes',()=>{
 reset();reg(0,0x2000n);vec(9,[1,2,3,4]);run('440f2908');expect(Array.from({length:4},(_,i)=>dv.getUint32(ex.memory_bytes()+0x2000+4*i,true))).toEqual([1,2,3,4]);
 vec(8,[9,9,9,9]);run('440f1000');expect(words(8)).toEqual([1,2,3,4]);run('f3440f1000');expect(words(8)).toEqual([1,0,0,0]);
 run('f2440f1000');expect(words(8)).toEqual([1,2,0,0]);run('66440f6f00');expect(words(8)).toEqual([1,2,3,4]);
 reg(0,0x2010n);run('66440fd600');expect(dv.getBigUint64(ex.memory_bytes()+0x2010,true)).toBe(0x200000001n);
});
it('SSE2 saturation, sign comparisons, integer shifts, packs, converts and masks are lane-exact',()=>{
 reset();vec(0,[0x7fff7fff,0x7fff7fff,0x7fff7fff,0x7fff7fff]);vec(1,[0x00010001,0x00010001,0x00010001,0x00010001]);run('660fedc1');expect(words(0)).toEqual([0x7fff7fff,0x7fff7fff,0x7fff7fff,0x7fff7fff]);
 vec(0,[0x80008000,0x00020001,0xffff0000,0x00040003]);run('660f71e001');expect(words(0)).toEqual([0xc000c000,0x00010000,0xffff0000,0x00020001]);
 vec(0,[1,0xffffffff,128,32767]);vec(1,[0xffffff80,0xffff7fff,0,5]);run('660f6bc1');expect(words(0)).toEqual([0xffff0001,0x7fff0080,0x8000ff80,0x00050000]);
 vec(0,[1,2,0xffffffff,0x80000000]);run('0f5bc0');expect(floats(0)).toEqual([1,2,-1,-2147483648]);
 vec(0,[1.9,-2.9,3.5,-4.5],'f32');run('f30f5bc0');expect(words(0)).toEqual([1,0xfffffffe,3,0xfffffffc]);
 vec(0,[1,2,3,4],'f32');run('0f5ac0');expect(floats(0,true)).toEqual([1,2]);
 vec(0,[-1,2,-3,4],'f32');run('0f50c0');expect(reg(0)).toBe(5n);
});

it('CPUID advertises only implemented baseline paths, with no AVX/AES/BMI/XSAVE',()=>{
 reset();reg(0,1n);run('0fa2');expect(reg(2)&((1n<<25n)|(1n<<26n))).toBe((1n<<25n)|(1n<<26n));expect(reg(1)).toBe(0n);reg(0,7n);run('0fa2');expect(reg(3)).toBe(0n);expect(reg(1)).toBe(0n);
});
