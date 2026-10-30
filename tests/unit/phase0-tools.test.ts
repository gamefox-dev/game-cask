import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, copyFileSync, chmodSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
// @ts-expect-error plain ESM
import { inventory } from '../../tools/inspect/inspect.mjs';
// @ts-expect-error plain ESM
import { peMetadata } from '../../tools/inspect/pe.mjs';
// @ts-expect-error plain ESM
import { buildFixture, x86tool } from '../../tools/build/pipeline.mjs';
// @ts-expect-error plain ESM
import { leakcheck } from '../../tools/report/leakcheck.mjs';
// @ts-expect-error plain ESM
import { fillBrief } from '../../tools/report/trial-brief.mjs';

// @ts-expect-error plain ESM
import { setupTrial } from '../../tools/report/trial-setup.mjs';

const temp = () => mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/phase0-'));

describe('Phase 0 tooling regressions', () => {
  it('hashes ALL of a file above 256 MiB using bounded streaming; counts a printable run across chunks', () => {
    const dir = temp(), path = join(dir, 'large.dat');
    const fd = openSync(path, 'w'); ftruncateSync(fd, 257 * 1024 * 1024);
    writeSync(fd,Buffer.from('abcDEFghi'),0,9,1024*1024-4);closeSync(fd);
    // Hash reference via a separate streaming implementation, not inventory.
    const expected = execFileSync(process.execPath, ['--input-type=module', '-e', `import {createReadStream} from 'node:fs'; import {createHash} from 'node:crypto'; const h=createHash('sha256'); for await (const b of createReadStream(process.argv[1])) h.update(b); console.log(h.digest('hex'));`, path], { encoding: 'utf8' }).trim();
    const inv = inventory(dir).files[0];
    expect(inv.sha256).toBe(expected); expect(inv.truncated).toBe(false); expect(inv.sampleBytes).toBe(1024 * 1024);expect(inv.printableRuns).toBe(1);
  });

  it('PE32+ imports are mapped past a section with oversized raw data, bounded by the directory', () => {
    const dir = temp(); writeFileSync(join(dir, 'tiny.c'), '#include <windows.h>\nint _tls_index=0; void entry(void){ExitProcess(0);}\n');
    // Real x64 fixture, linked by kit Zig. Mutation adds a raw overlay without changing the virtual span.
    const zig = JSON.parse(execFileSync('zig', ['env'], { encoding: 'utf8' }));
    execFileSync('zig', ['cc', '-target', 'x86_64-windows-gnu', '-isystem', join(zig.lib_dir,'libc/include/any-windows-any'), '-nostdlib', '-Wl,--entry,entry', '-Wl,--subsystem,windows', '-o', join(dir,'x.exe'), join(dir,'tiny.c'), '-lkernel32']);
    const b = readFileSync(join(dir, 'x.exe')), nt = b.readUInt32LE(60), opt = nt + 24, so = opt + b.readUInt16LE(nt + 20);
    b.writeUInt32LE(0x30000000, so + 16);
    const p = peMetadata((o: number,n: number) => b.subarray(o,o+n), b.length);
    expect(p.pe32plus).toBe(true); expect(p.imports.map((s: string) => s.toLowerCase())).toContain('kernel32.dll'); expect(p.importErrors).toEqual([]);
    // Invalid import directory reports a parse error, never [""] or a traceback.
    b.writeUInt32LE(0x7ffff000, opt + 112 + 8);
    expect(peMetadata((o: number,n: number) => b.subarray(o,o+n), b.length).importErrors.length).toBe(1);
    writeFileSync(join(dir,'bad.exe'), b);
    const out = execFileSync('python3', ['-I', join(ROOT,'tools/extract/extract.py'), join(dir,'bad.exe'), join(dir,'out')], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
    expect(out).not.toContain('Traceback');
  }, 120_000);

  it('analyzer accepts PE32 files with overlays beyond the old 64 MiB limit', () => {
    const dir = temp(), exe = buildFixture(join(ROOT,'tests/fixtures/win32'), { sources:['data_in_text.c'], out:'large.exe', entry:'entry', libs:['user32','kernel32'] }, dir);
    const fd = openSync(exe, 'r+'); ftruncateSync(fd, 65 * 1024 * 1024); closeSync(fd);
    const out = JSON.parse(execFileSync(x86tool(), ['analyze',exe], { encoding:'utf8' }));
    expect(out.totals.instructions).toBeGreaterThan(0);
  });

  it('leakcheck ignores padding windows but still catches distinctive embedded payload and identical padding', () => {
    const root = temp(), refs = temp(); mkdirSync(join(root,'docs'));
    execFileSync('git',['init'],{cwd:root,stdio:'ignore'});
    writeFileSync(join(refs,'pad.dat'), Buffer.alloc(4096,255));
    writeFileSync(join(root,'docs','safe.txt'), Buffer.alloc(80,255));
    expect(leakcheck({root,against:[refs]}).problems).toEqual([]);
    writeFileSync(join(root,'docs','identical.txt'), Buffer.alloc(4096,255));
    expect(leakcheck({root,against:[refs]}).problems.some((p: any) => /identical/.test(p.why))).toBe(true);
    const payload = Buffer.from(Array.from({length:4096}, (_,i)=>(i*17+3)&255));
    writeFileSync(join(refs,'unique.dat'),payload);
    writeFileSync(join(root,'docs','embedded.txt'),Buffer.concat([Buffer.from('prefix'),payload.subarray(0,100),Buffer.from('suffix')]));
    expect(leakcheck({root,against:[refs]}).problems.some((p: any)=>p.path==='docs/embedded.txt' && /embeds/.test(p.why))).toBe(true);
  });

  it('trial setup creates an independent remote-free clone at the exact commit, installs and writes a sliced brief', () => {
    const source = temp(), parent = temp(), dest = join(parent, 'trial');
    mkdirSync(join(source,'tools/report'), { recursive:true }); mkdirSync(join(source,'tools/build'), { recursive:true }); mkdirSync(join(source,'docs'));
    copyFileSync(join(ROOT,'tools/report/trial-brief.mjs'),join(source,'tools/report/trial-brief.mjs'));
    copyFileSync(join(ROOT,'docs/trial-brief.md'),join(source,'docs/trial-brief.md'));
    writeFileSync(join(source,'tools/build/toolchain.mjs'), `import {fileURLToPath} from 'node:url'; export const ROOT=fileURLToPath(new URL('../../',import.meta.url));`);
    writeFileSync(join(source,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',private:true,type:'module'}));
    writeFileSync(join(source,'package-lock.json'),JSON.stringify({name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0'}}}));
    const git = (...a: string[]) => execFileSync('git',a,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git('init'); git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','CC0 setup fixture');
    const commit = git('rev-parse','HEAD');
    const game = join(parent,'fixture.input'); writeFileSync(game,'CC0 synthetic input');
    const result = setupTrial({ source,kit:commit,game,dir:dest,slice:'boot to loop' });
    expect(result.commit).toBe(commit);
    expect(execFileSync('git',['remote'],{cwd:dest,encoding:'utf8'}).trim()).toBe('');
    expect(readFileSync(join(dest,'original/fixture.input'),'utf8')).toBe('CC0 synthetic input');
    expect(readFileSync(join(dest,'reports/brief.md'),'utf8')).toContain('boot to loop');
    expect(()=>setupTrial({source,kit:commit,game,dir:dest})).toThrow(/already exists/);
  }, 120_000);

  it('pi driver records a local fake CLI session without model credentials or user-specific paths', () => {
    const dir = temp(), cli = join(dir,'fake-pi');
    writeFileSync(cli, '#!/usr/bin/env python3\nimport sys,os,json\nd=sys.argv[sys.argv.index("--session-dir")+1]\nos.makedirs(d,exist_ok=True)\nwith open(os.path.join(d,"s.jsonl"),"w") as f:\n f.write(json.dumps({"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"fixture final"}],"stopReason":"stop"}})+"\\n")\n');
    chmodSync(cli,0o755); writeFileSync(join(dir,'prompt'),'fixture');
    execFileSync('bash',[join(ROOT,'tools/harness/pi/run-pi.sh'),dir,join(dir,'prompt'),join(dir,'result')],{env:{...process.env,PI_BIN:cli,PI_MODEL:'fixture/model',PI_TIMEOUT:'5'},stdio:'pipe'});
    expect(readFileSync(join(dir,'result'),'utf8').trim()).toBe('fixture final');
    expect(JSON.parse(readFileSync(join(dir,'result.d/run.json'),'utf8')).exit).toBe(0);
  });

  it('pi driver timeout is reported distinctly and does not silently succeed',()=>{
    const dir=temp(),cli=join(dir,'sleep-pi');writeFileSync(cli,'#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n');chmodSync(cli,0o755);writeFileSync(join(dir,'prompt'),'fixture');
    let code=0;try{execFileSync('bash',[join(ROOT,'tools/harness/pi/run-pi.sh'),dir,join(dir,'prompt'),join(dir,'result')],{env:{...process.env,PI_BIN:cli,PI_MODEL:'fixture/model',PI_TIMEOUT:'1'},stdio:'pipe'});}catch(e){code=(e as {status:number}).status;}
    expect(code).toBe(4);expect(JSON.parse(readFileSync(join(dir,'result.d/run.json'),'utf8')).exit).toBe(4);
  });

  it('launcher-selected slice becomes the explicit L3 and packaging contract', () => {
    const text = fillBrief(readFileSync(join(ROOT,'docs/trial-brief.md'),'utf8'), {game:'fixture.exe',slug:'fixture',sha256:'a'.repeat(64),kit:'123',date:'today',scratch:'/tmp/fixture',slice:'boot → title → loop complete'});
    expect(text).toContain('boot → title → loop complete'); expect(text).toContain("launcher's L3 definition and packaging scope");
  });
});
