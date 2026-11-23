// Execute the pinned npm Binaryen CLI unchanged, adding diagnostics in its lexical scope.
// Binaryen 132's Emscripten C++ exceptions otherwise print only an opaque excPtr.
import fs, { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
const file = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/binaryen/bin/wasm-opt');
process.argv[1] = file;
const diagnostics = `
;function bgtBinaryenFailure(error) {
 let type = error?.name || error?.constructor?.name || 'unknown';
 try { if (error instanceof CppException) {
   const info = new ExceptionInfo(error.excPtr);
   type = UTF8ToString(HEAPU32[(info.get_type() + 4) >>> 2]);
 } } catch {}
 const heap = typeof HEAPU8 !== 'undefined' ? HEAPU8.length : null;
 const max = typeof getHeapMax === 'function' ? getHeapMax() : null;
 console.error('BGT Binaryen failure: ' + JSON.stringify({type, heap_bytes:heap, max_heap_bytes:max, message:error?.message || String(error)}));
 if (/bad_alloc/.test(type) || (heap !== null && heap === max)) console.error('Binaryen wasm32 allocator exhausted (at most 4 GiB); use bounded Asyncify partitions or a JSPI-only build, not a larger Node --max-old-space-size.');
 process.exitCode = 1;
}
process.once('unhandledRejection', bgtBinaryenFailure);
process.once('uncaughtException', bgtBinaryenFailure);
`;
// K65: an exact pre-O2 onlylist names functions that -O2 inlined or removed; Binaryen warns once
// per name (NODERAWFS writes fd 2 directly). Those are expected (an absent function cannot run):
// count them instead of flooding the log. Every other stderr byte is forwarded line by line.
let absentOnly = 0, pending = '';
const writeSync = fs.writeSync;
const ABSENT = /^warning: Asyncify onlylist contained a non-existing function name: '[^']*'$/;
const flush = (all) => {
  const lines = pending.split('\n'); pending = all ? '' : lines.pop();
  for (const line of all ? lines.filter((l, i) => l || i < lines.length - 1) : lines) {
    if (ABSENT.test(line)) absentOnly++; else writeSync.call(fs, 2, line + '\n');
  }
};
fs.writeSync = function (fd, buffer, ...rest) {
  if (fd !== 2) return writeSync.call(fs, fd, buffer, ...rest);
  const [offset = 0, length] = typeof rest[0] === 'number' ? rest : [];
  const bytes = typeof buffer === 'string' ? Buffer.from(buffer) : Buffer.from(buffer.buffer, buffer.byteOffset + offset, length ?? buffer.byteLength - offset);
  pending += bytes.toString('utf8'); if (pending.includes('\n')) flush(false);
  return bytes.length;
};
process.once('exit', () => { flush(true); if (absentOnly) writeSync.call(fs, 2, 'Asyncify onlylist: ' + absentOnly + ' listed function(s) were inlined or removed by earlier passes\n'); });
const cli = new Module(file);
cli.filename = file;
cli.paths = Module._nodeModulePaths(dirname(file));
const source = readFileSync(file, 'utf8');
const limitCheck = 'if(requestedSize>maxHeapSize){return false}';
if (!source.includes(limitCheck)) throw new Error('unsupported Binaryen CLI heap implementation; expected pinned Binaryen 132');
const instrumented = source.replace(limitCheck, 'if(requestedSize>maxHeapSize){console.error("BGT Binaryen wasm32 heap limit: requested_bytes="+requestedSize+" max_heap_bytes="+maxHeapSize);return false}');
cli._compile(instrumented + diagnostics, file);
