#!/usr/bin/env node
// Original CC0 code. Deterministic engine-scale input, not derived from any game.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function generate(dir, count = 12000) {
  if (!Number.isInteger(count) || count < 8 || count > 20000) throw new Error('functions must be 8..20000');
  mkdirSync(dir, { recursive: true });
  const sources = [];
  for (let start = 0; start < count; start += 200) {
    let c = '/* Original CC0 generated C, normal -O2. */\n#include <stdint.h>\n';
    for (let i = start; i < Math.min(start + 200, count); i++) {
      c += `__attribute__((noinline)) uint32_t scale_${i}(uint32_t v, double d) {\n`;
      c += 'switch(v & 7u) {\n';
      for (let k = 0; k < 8; k++) c += `case ${k}: v = (v * ${3 + 2 * k}u) ^ ${((i + 1) * 7919 + k * 31) >>> 0}u; break;\n`;
      c += '}\n';
      for (let k = 0; k < 24; k++) c += `v ^= v >> 13; v = v * 1664525u + ${((i + 1) * 101 + k * 127) >>> 0}u;\n`;
      c += `d = d * 1.5 + ${i % 17}.25; return v ^ (uint32_t)d;\n}\n`;
    }
    const name = `functions-${String(start).padStart(5, '0')}.c`;
    writeFileSync(join(dir, name), c); sources.push(name);
  }
  let main = '#include <stdint.h>\n#include <stdlib.h>\n#include <stdio.h>\n#include <string.h>\n#ifdef _WIN32\n#include <windows.h>\n#endif\n';
  for (let i = 0; i < count; i++) main += `uint32_t scale_${i}(uint32_t,double);\n`;
  main += `static uint32_t (*const fns[])(uint32_t,double)={${Array.from({ length: count }, (_, i) => `scale_${i}`).join(',')}};\n`;
  main += `int main(void) { uint32_t v=1; char *text=(char*)malloc(128); if(!text)return 2;\nfor(unsigned i=0;i<${count};i++) v=fns[i](v,(double)(i&255));\nsnprintf(text,128,"scale checksum %08x functions %u",v,${count}u);\n#ifdef _WIN32\nOutputDebugStringA(text); free(text);\nfor(unsigned frame=0;;frame++){ v=fns[frame%${count}](v,(double)(frame&255)); if(frame%60==0){char line[80];snprintf(line,sizeof line,"scale tick %u %08x",frame,v);OutputDebugStringA(line);} Sleep(16); }\n#else\nputs(text);free(text);return 0;\n#endif\n}\n`;
  writeFileSync(join(dir, 'main.c'), main); sources.push('main.c');
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(sources) + '\n');
  return sources;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = generate(resolve(process.argv[2]), Number(process.argv[3] ?? 12000));
  console.log(JSON.stringify(sources));
}
