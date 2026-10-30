// Static PE32/PE32+ metadata, not a decoder or conversion claim. Bounded positional reads.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { peMetadata } from '../inspect/pe.mjs';

export function analyzePeMetadata(path) {
  const fd = openSync(path, 'r');
  try {
    const read = (o, n) => { const b = Buffer.alloc(n); return b.subarray(0, readSync(fd,b,0,n,o)); };
    const pe = peMetadata(read, fstatSync(fd).size);
    const { rvaToOffset: off, ...metadata } = pe;
    const [rva, bytes] = pe.directories[3];
    const functions = [], errors = [];
    if (pe.pe32plus && rva && bytes) {
      try {
        if (bytes % 12) throw new Error('exception directory size is not a multiple of RUNTIME_FUNCTION (12 bytes)');
        if (bytes / 12 > 1_000_000) throw new Error('exception directory exceeds one million records');
        for (let i = 0; i < bytes; i += 12) {
          const b = read(off(rva+i,12),12), begin = b.readUInt32LE(0), end = b.readUInt32LE(4), unwind = b.readUInt32LE(8);
          if (begin >= end) throw new Error(`invalid runtime function at index ${i/12}`);
          const u = read(off(unwind,4),4), count = u[2], codes = read(off(unwind+4, count*2), count*2);
          functions.push({ beginRva:begin,endRva:end,unwindRva:unwind,version:u[0]&7,flags:u[0]>>3,prologBytes:u[1],codeSlots:count,frameRegister:u[3]&15,frameOffset:u[3]>>4,unwindCodes:[...codes] });
        }
      } catch (e) { errors.push(e.message); }
    }
    return { schema:'game-cask/pe-metadata/1', ...metadata, runtimeFunctions:functions, errors,
      conversion: pe.pe32plus ? { supported:false, reason:'Win64 decoding/semantics, thunks and unwinding are not implemented; metadata is not lifted code' } : { supported:true, mode:'i386 Win32 pipeline' } };
  } finally { closeSync(fd); }
}
