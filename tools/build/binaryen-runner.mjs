// Execute the pinned npm Binaryen CLI unchanged, adding diagnostics in its lexical scope.
// Binaryen 132's Emscripten C++ exceptions otherwise print only an opaque excPtr.
import { readFileSync } from 'node:fs';
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
const cli = new Module(file);
cli.filename = file;
cli.paths = Module._nodeModulePaths(dirname(file));
const source = readFileSync(file, 'utf8');
const limitCheck = 'if(requestedSize>maxHeapSize){return false}';
if (!source.includes(limitCheck)) throw new Error('unsupported Binaryen CLI heap implementation; expected pinned Binaryen 132');
const instrumented = source.replace(limitCheck, 'if(requestedSize>maxHeapSize){console.error("BGT Binaryen wasm32 heap limit: requested_bytes="+requestedSize+" max_heap_bytes="+maxHeapSize);return false}');
cli._compile(instrumented + diagnostics, file);
