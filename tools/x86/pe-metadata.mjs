// Static PE32/PE32+ metadata, not a decoder or conversion claim. Bounded positional reads.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { peMetadata } from '../inspect/pe.mjs';

export function analyzePeMetadata(path) {
  const fd = openSync(path, 'r');
  try {
    const read = (o, n) => {
      const b = Buffer.alloc(n);
      if (readSync(fd, b, 0, n, o) !== n) throw new Error('short PE read');
      return b;
    };
    const pe = peMetadata(read, fstatSync(fd).size);
    const { rvaToOffset: off, ...metadata } = pe;
    const [rva, bytes] = pe.directories[3];
    const functions = [], errors = [], diagnostics = [];
    const imageRange = (r, n) => {
      if (!Number.isSafeInteger(r) || r < 0 || n <= 0 || r + n > pe.imageBytes) throw new Error('RVA range outside image');
    };
    const at = (r, n) => { imageRange(r, n); return read(off(r, n), n); };
    if (pe.pe32plus && !!rva !== !!bytes) errors.push('exception directory RVA/size must both be zero or both nonzero');
    if (pe.pe32plus && rva && bytes) {
      if (bytes % 12) errors.push('exception directory size is not a multiple of RUNTIME_FUNCTION (12 bytes)');
      if (bytes / 12 > 1_000_000) errors.push('exception directory exceeds one million records');
      else {
        for (let i = 0; i + 12 <= bytes; i += 12) {
          const index = i / 12;
          let f;
          try {
            const b = at(rva + i, 12), begin = b.readUInt32LE(0), end = b.readUInt32LE(4), unwind = b.readUInt32LE(8);
            if (!begin && !end) {
              diagnostics.push({ index, kind: 'empty-runtime-function', beginRva: begin, endRva: end, unwindRva: unwind });
              continue; // An empty range is not an end-of-table sentinel; Size bounds the table.
            }
            if (begin >= end) throw new Error('reversed or zero-length runtime function');
            imageRange(begin, end - begin);
            f = { index, beginRva: begin, endRva: end, unwindRva: unwind };
            functions.push(f); // Keep a valid range even when its unwind metadata is malformed.
            if (unwind & 3) throw new Error('unaligned UNWIND_INFO');
            const u = at(unwind, 4), count = u[2], version = u[0] & 7, flags = u[0] >> 3;
            if (version !== 1 && version !== 2) throw new Error(`unsupported UNWIND_INFO version ${version}`);
            if ((flags & ~7) || ((flags & 4) && (flags & 3))) throw new Error('invalid UNWIND_INFO flags');
            const codes = count ? at(unwind + 4, count * 2) : Buffer.alloc(0);
            Object.assign(f, { version, flags, prologBytes: u[1], codeSlots: count, frameRegister: u[3] & 15, frameOffset: u[3] >> 4, unwindCodes: [...codes] });
            const tail = unwind + 4 + ((count + 1) & ~1) * 2;
            if (flags & 4) {
              const c = at(tail, 12), beginRva = c.readUInt32LE(0), endRva = c.readUInt32LE(4), unwindRva = c.readUInt32LE(8);
              if (beginRva >= endRva) throw new Error('invalid chained runtime function');
              imageRange(beginRva, endRva - beginRva);
              if (unwindRva & 3) throw new Error('unaligned chained UNWIND_INFO');
              at(unwindRva, 4);
              f.chainedFunction = { beginRva, endRva, unwindRva };
            } else if (flags & 3) {
              f.handlerRva = at(tail, 4).readUInt32LE(0); imageRange(f.handlerRva, 1);
              f.handlerDataRva = tail + 4; // Language-specific payload has no generic size/format.
            }
          } catch (e) {
            const message = `runtime function at index ${index}: ${e.message}`;
            errors.push(message); diagnostics.push({ index, kind: 'invalid-runtime-function', message });
            if (f) f.unwindError = e.message;
          }
        }
      }
    }
    return { schema: 'game-cask/pe-metadata/1', ...metadata, runtimeFunctions: functions, diagnostics, errors,
      conversion: pe.pe32plus ? { supported: true, mode: 'AMD64 Win64 pipeline (rebased flat guest mapping); metadata itself is not lifted code' } : { supported: true, mode: 'i386 Win32 pipeline' } };
  } finally { closeSync(fd); }
}
