// Test-only store barriers. One private wasm page holds a byte per memory32 page;
// it is never part of guest addresses, globals or the serialized checkpoint.
export function wasmUint(n: number): number[] {
  const out: number[] = [];
  do { const b = n % 128; n = Math.floor(n / 128); out.push(b | (n ? 128 : 0)); } while (n);
  return out;
}
export function wasmI32(n: number): number[] {
  const out: number[] = [];
  n |= 0;
  for (;;) {
    const byte = n & 127; n >>= 7;
    if ((n === 0 && !(byte & 64)) || (n === -1 && (byte & 64))) return [...out, byte];
    out.push(byte | 128);
  }
}
export function joinWasm(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; } return out;
}
export function wasmReader(data: Uint8Array, start = 0, end = data.length) {
  let pos = start;
  const byte = () => { if (pos >= end) throw new Error('Truncated checkpoint wasm'); return data[pos++]; };
  const uint = () => {
    let n = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = byte(); n += (b & 127) * 2 ** shift;
      if (!(b & 128) && n <= 0xffffffff) return n;
    }
    throw new Error('Invalid checkpoint wasm u32');
  };
  const skip = (n: number) => { if (n > end - pos) throw new Error('Truncated checkpoint wasm'); pos += n; };
  const leb = (max: number) => { for (let i = 0; i < max; i++) if (!(byte() & 128)) return; throw new Error('Invalid checkpoint wasm LEB'); };
  return {byte, uint, skip, leb, get pos() { return pos; }};
}

const i32 = 0x7f;
const stores = [[i32,4],[0x7e,8],[0x7d,4],[0x7c,8],[i32,1],[i32,2],[0x7e,1],[0x7e,2],[0x7e,4]];
const get = (i: number) => [0x20,i];
const constant = (n: number) => [0x41,...wasmI32(n)];
const call = (i: number) => [0x10,...wasmUint(i)];
type Helper = (params: number[], body: number[]) => number;

/** Replace store/copy/fill with same-signature helpers (interned by opcode/memarg).
 * The original instruction runs first: exact trap/overflow behavior is unchanged.
 * No per-store JS callbacks, bytecode index relocation or duplicated function bodies. */
export function trackWasmStores(code: Uint8Array, helper: Helper): Uint8Array<ArrayBuffer> {
  // mark(start, endInclusive), called only after a successful nonempty write.
  const mark = helper([i32,i32], [
    ...get(0),...constant(16),0x76,0x21,0, // start >>= 16
    ...get(1),...constant(16),0x76,0x21,1,
    0x03,0x40, // loop
      ...get(0),...constant(1),0x3a,0x40,1,0, // i32.store8 $memory1
      ...get(0),...get(1),0x49,0x04,0x40, // if start < end
        ...get(0),...constant(1),0x6a,0x21,0,0x0c,1,
      0x0b,
    0x0b,
  ]);
  const barriers = new Map<string, Uint8Array>();
  function barrier(op: number, offset: number, align: number, bulk: number, original: Uint8Array) {
    const key = op+':'+offset+':'+align+':'+bulk;
    let bytes = barriers.get(key);
    if (bytes) return bytes;
    const [value, width] = stores[op-0x36] ?? [i32,0];
    const body = [...get(0),...get(1)];
    if (bulk) body.push(...get(2));
    body.push(...original);
    if (bulk) body.push(...get(2),0x04,0x40); // len != 0
    body.push(...get(0),...constant(offset),0x6a,...get(0),...constant(offset),0x6a);
    if (bulk) body.push(...get(2),0x6a,...constant(1),0x6b);
    else body.push(...constant(width-1),0x6a);
    body.push(...call(mark));
    if (bulk) body.push(0x0b);
    bytes = new Uint8Array(call(helper(bulk?[i32,i32,i32]:[i32,value],body)));
    barriers.set(key,bytes);return bytes;
  }
  const codeReader=wasmReader(code), n=codeReader.uint();
  const bodies:Uint8Array[]=[new Uint8Array(wasmUint(n))];
  for (let i=0;i<n;i++) {
    const bodyStart=codeReader.pos, size=codeReader.uint(), start=codeReader.pos, end=start+size;
    codeReader.skip(size);
    const r=wasmReader(code,start,end);
    for(let j=r.uint();j;j--){r.uint();r.byte();}
    const ranges: Uint8Array[]=[];
    let copied=start, length=size;
    while (r.pos<end) {
      const at=r.pos, op=r.byte();
      let align=0,offset=0,bulk=0;
      if(op>=0x28&&op<=0x3e) {
        align=r.uint(); if(align>=0x40)throw new Error('Unsupported checkpoint memory immediate');
        offset=r.uint();
      } else if(op<=1||op===5||op===11||op===15||op===26||op===27||op>=0x45&&op<=0xc4||op===0xd1) {
        // No immediate.
      } else switch(op) {
        case 2:case 3:case 4:case 0xd0:r.leb(5);break;
        case 12:case 13:case 16:case 18:case 32:case 33:case 34:case 35:case 36:case 37:case 38:case 0xd2:r.uint();break;
        case 14:for(let j=r.uint();j;j--)r.uint();r.uint();break;
        case 17:case 19:r.uint();r.uint();break;
        case 28:r.skip(r.uint());break;
        case 63:case 64:if(r.uint())throw new Error('Unsupported checkpoint memory index');break;
        case 65:r.leb(5);break;
        case 66:r.leb(10);break;
        case 67:r.skip(4);break;
        case 68:r.skip(8);break;
        case 0xfc: {
          const sub=r.uint();
          if(sub<=7)break;
          if(sub===10||sub===11) {
            if(r.uint()||(sub===10&&r.uint()))throw new Error('Unsupported checkpoint bulk memory index');
            bulk=sub;break;
          }
          if(sub===12||sub===14){r.uint();r.uint();break;}
          if(sub===13||sub===15||sub===16||sub===17){r.uint();break;}
          throw new Error('Unsupported checkpoint bulk opcode '+sub);
        }
        default:throw new Error('Unsupported checkpoint write-tracking opcode 0x'+op.toString(16));
      }
      if(op>=0x36&&op<=0x3e||bulk) {
        const bytes=barrier(op,offset,align,bulk,code.subarray(at,r.pos));
        if(at>copied)ranges.push(code.subarray(copied,at));
        ranges.push(bytes);length+=bytes.length-(r.pos-at);copied=r.pos;
      }
    }
    // Own one replacement body at a time, not a subarray object per store across the module.
    if(copied===start)bodies.push(code.subarray(bodyStart,end));
    else bodies.push(joinWasm([new Uint8Array(wasmUint(length)),...ranges,code.subarray(copied,end)]));
  }
  if(codeReader.pos!==code.length)throw new Error('Trailing checkpoint wasm code');
  return joinWasm(bodies);
}

// Engines without multi-memory retain the older exact sparse scan. There is no
// write-tracking promise on those engines; do not silently ignore a write opcode.
export const supportsDirtyTracking = () => WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,5,2,0,1,0,1]));
export function markHostWrite(dirty: Uint8Array, at: number, bytes: number): void {
  if(bytes>0)dirty.fill(1,at>>>16,Math.floor((at+bytes-1)/65536)+1);
}
