// @bgt-examples: none
// A minimal independent kit workspace keeps this subprocess regression from
// rebuilding/deleting artifacts another parallel unit file might be reading.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { ROOT } from '../support/headless';
const run = promisify(execFile);

it('custom reporters still rebuild only the selected declaration, never stale or unrelated examples', async () => {
  const dir = mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/test-selection-'));
  try {
    for (const d of ['tools/build', 'tools/inspect', 'tools/x86', 'tests/unit', 'bgt/sdk', 'bgt/include', 'examples/selected', 'examples/unselected']) mkdirSync(join(dir, d), { recursive: true });
    // Orchestration imports are lazy about platform contents; this is native C,
    // not a profile/lifter mock and never a Windows program.
    cpSync(join(ROOT, 'tools/build'), join(dir, 'tools/build'), { recursive: true });
    cpSync(join(ROOT, 'tools/inspect/pe.mjs'), join(dir, 'tools/inspect/pe.mjs'));
    cpSync(join(ROOT, 'tools/x86/mkres.mjs'), join(dir, 'tools/x86/mkres.mjs'));
    cpSync(join(ROOT, 'bgt/sdk/bgt_libc.c'), join(dir, 'bgt/sdk/bgt_libc.c'));
    cpSync(join(ROOT, 'bgt/include'), join(dir, 'bgt/include'), { recursive: true });
    cpSync(join(ROOT, 'tests/unit/global-setup.ts'), join(dir, 'tests/unit/global-setup.ts'));
    cpSync(join(ROOT, '.zig-version'), join(dir, '.zig-version'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    // Resolve Vitest/Binaryen without installing or copying node_modules.
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    for (const name of ['vitest', 'binaryen']) symlinkSync(join(ROOT, 'node_modules', name), join(dir, 'node_modules', name));
    for (const id of ['selected', 'unselected']) {
      writeFileSync(join(dir, 'examples', id, 'game.json'), JSON.stringify({ id, name: id, sources: ['main.c'] }));
      writeFileSync(join(dir, 'examples', id, 'main.c'), '#include "bgt.h"\nBGT_EXPORT(value) int value(void){return 41;}\n');
    }
    const test = join(dir, 'tests/unit/selected.test.ts');
    writeFileSync(test, `// @bgt-examples: selected\nimport{it,expect}from'vitest';import{readFileSync,existsSync}from'node:fs';it('fresh selected artifact',async()=>{const m=new WebAssembly.Module(readFileSync('web/public/games/selected/game.wasm'));const i=await WebAssembly.instantiate(m,{});expect(i.exports.value()).toBe(42);expect(existsSync('web/public/games/unselected')).toBe(false);});\n`);
    writeFileSync(join(dir, 'vitest.config.mjs'), `export default {test:{include:['tests/unit/*.test.ts'],globalSetup:['tests/unit/global-setup.ts'],testTimeout:60000}};`);
    const args = [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--root', dir, '--config', join(dir, 'vitest.config.mjs'), '--reporter=dot', '--maxWorkers=1'];
    // First build a stale 41 artifact independently, then change ONLY the source.
    await run(process.execPath, [join(dir, 'tools/build/build.mjs'), 'examples/selected'], { cwd: dir });
    writeFileSync(join(dir, 'examples/selected/main.c'), '#include "bgt.h"\nBGT_EXPORT(value) int value(void){return 42;}\n');
    const result = await run(process.execPath, args, { cwd: dir, timeout: 60000, env: { ...process.env, BGT_HEAVY_HELD: '1' } });
    expect(result.stdout).toContain('Test examples: examples/selected');
    expect(result.stdout).toContain('built selected:');
    expect(result.stdout).toContain('1 passed');
    expect(existsSync(join(dir, 'web/public/games/unselected'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'web/public/games/selected/manifest.json'), 'utf8')).id).toBe('selected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 90_000);
