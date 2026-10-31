// Original CC0 cross-lane probes: real compiled Win32/Win64 guests, no game input.
import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

const source = String.raw`
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#ifndef _WIN64
unsigned _tls_index;
#endif
static unsigned failures;
#define CHECK(x) do { if(!(x)){OutputDebugStringA("FAIL " #x);failures++;} } while(0)
typedef BOOL (WINAPI *exists_fn)(LPCWSTR);
static volatile unsigned total, counts[3], last[3], maxgap[3];
static DWORD WINAPI worker(void *arg) {
 unsigned i=(unsigned)(uintptr_t)arg;
 while(total<900){
  unsigned turn=++total, gap=turn-last[i];last[i]=turn;
  if(gap>maxgap[i])maxgap[i]=gap;
  counts[i]++;
  if(i==1)CHECK(SetThreadPriority(GetCurrentThread(),2));
  SwitchToThread();
 }
 return 0;
}
#ifdef _WIN64
int main(void) {
#else
void entry(void) {
#endif
 exists_fn exists=(exists_fn)GetProcAddress(LoadLibraryA("shlwapi.dll"),"PathFileExistsW");
 CHECK(exists!=0);if(!exists)ExitProcess(1);
 CHECK(exists(L"probe.exe") && exists(L"nested") && exists(L"NESTED\\seed.txt"));
 CHECK(CreateDirectoryW(L"writable",0));
 SetLastError(1234);CHECK(exists(L"C:\\GAME\\WRITABLE\\"));CHECK(GetLastError()==1234);
 CHECK(GetFileAttributesW(L"writable")&FILE_ATTRIBUTE_DIRECTORY);
#ifdef _WIN64
 FILE *f=fopen("writable/new.tmp","w+b");CHECK(f!=0);
 CHECK(exists(L"writable/new.tmp"));
 CHECK(fwrite("abc",1,3,f)==3);
 WIN32_FIND_DATAW fd;HANDLE find=FindFirstFileW(L"writable/*.tmp",&fd);
 CHECK(find!=INVALID_HANDLE_VALUE && fd.nFileSizeLow==3 && !(fd.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY));
 CHECK(FindClose(find));CHECK(GetFileAttributesW(L"writable/new.tmp")==FILE_ATTRIBUTE_ARCHIVE);
 CHECK(fclose(f)==0);CHECK(exists(L"writable/new.tmp"));
 CHECK(_wrename(L"writable/new.tmp",L"writable/moved.tmp")==0);
 CHECK(!exists(L"writable/new.tmp") && exists(L"writable/moved.tmp"));
 CHECK(remove("writable/moved.tmp")==0);CHECK(!exists(L"writable/moved.tmp"));
 SetLastError(5678);CHECK(!exists(L"absent.tmp"));CHECK(GetLastError()==5678);
 // Anonymous tmpfile has no pathname; it must not invent a visible index entry.
 FILE *tmp=tmpfile();CHECK(tmp!=0);CHECK(fwrite("temp",1,4,tmp)==4);CHECK(fclose(tmp)==0);
 CHECK(FindFirstFileW(L"writable/*.tmp",&fd)==INVALID_HANDLE_VALUE);
#endif
 // Fill every kernel file slot: metadata queries must not need another one.
 HANDLE handles[64];unsigned n=0;
 while(n<64){HANDLE h=CreateFileW(L"probe.exe",GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
  if(h==INVALID_HANDLE_VALUE)break;handles[n++]=h;}
 CHECK(n>0 && n<64);CHECK(exists(L"probe.exe") && exists(L"nested") && exists(L"writable"));
 for(unsigned i=0;i<n;i++)CHECK(CloseHandle(handles[i]));
 OutputDebugStringA(failures?"filesystem FAIL":"filesystem PASS");
 const int priorities[]={-15,-2,-1,0,1,2,15};
 for(unsigned i=0;i<sizeof priorities/sizeof *priorities;i++){
  CHECK(SetThreadPriority(GetCurrentThread(),priorities[i]));
  CHECK(GetThreadPriority(GetCurrentThread())==priorities[i]);
 }
 CHECK(!SetThreadPriority(GetCurrentThread(),3) && GetLastError()==ERROR_INVALID_PARAMETER);
 CHECK(GetThreadPriority(GetCurrentThread())==15);
 CHECK(!SetThreadPriority((HANDLE)123,0) && GetLastError()==ERROR_INVALID_HANDLE);
 CHECK(GetThreadPriority((HANDLE)123)==THREAD_PRIORITY_ERROR_RETURN && GetLastError()==ERROR_INVALID_HANDLE);
 CHECK(SetThreadPriority(GetCurrentThread(),0));
 HANDLE threads[3];
 for(unsigned i=0;i<3;i++){
  threads[i]=CreateThread(0,0,worker,(void *)(uintptr_t)i,CREATE_SUSPENDED,0);CHECK(threads[i]!=0);
  CHECK(SetThreadPriority(threads[i],i==0?-2:i==1?2:0));
 }
 for(unsigned i=0;i<3;i++)CHECK(ResumeThread(threads[i])==1);
 CHECK(WaitForMultipleObjects(3,threads,TRUE,INFINITE)==WAIT_OBJECT_0);
 CHECK(total==900 && counts[0]>80 && counts[1]>4*counts[0] && counts[2]>2*counts[0]);
 for(unsigned i=0;i<3;i++){CHECK(maxgap[i]<=5*64);CHECK(CloseHandle(threads[i]));}
 OutputDebugStringA(failures?"priority FAIL":"priority PASS");
 ExitProcess(failures?1:0);
}
`;

for (const [machine, target] of [['i386', 'x86-windows-gnu'], ['x86-64', 'x86_64-windows-gnu']]) {
  it(`${machine}: K1 metadata sees K2 VFS mutations and kernel priority drives bounded weighted scheduling`, async () => {
    const root = join(ROOT, 'node_modules/.cache/bgt/integration-i3');
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      writeFileSync(join(dir, 'probe.c'), source);
      mkdirSync(join(dir, 'assets/nested'), { recursive: true });
      writeFileSync(join(dir, 'assets/nested/seed.txt'), 'original fixture\n');
      const id = `integration-i3-${machine}`;
      writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 integration probe',
        assets: 'assets',
        pipeline: { platform: 'win32', fixture: { target, crt: machine === 'x86-64', ...(machine === 'i386' ? { entry: 'entry' } : {}), sources: ['probe.c'], out: 'probe.exe', libs: ['kernel32'] },
          modules: [{ from: './build/probe.exe', main: true }] } }));
      for (const interpretOnly of [false, true]) {
        const outRoot = join(dir, interpretOnly ? 'interpreted' : 'lifted');
        buildGame(dir, { quiet: true, interpretOnly, outRoot });
        const h = await loadHeadless(id, { dir: join(outRoot, id + (interpretOnly ? '-interp' : '')) });
        await h.stepAsync(100);
        expect(h.logs.filter((s) => s.includes('FAIL')), h.logs.join('\n')).toEqual([]);
        expect(h.logs).toContain('guest: filesystem PASS');
        expect(h.logs).toContain('guest: priority PASS');
        const m = h.host.metrics() as any;
        expect(m.stubs).toEqual([]);
        if (!interpretOnly) expect(m.interp_insns).toBe(0);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
}
