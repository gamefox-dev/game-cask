/* LANE-K1: behavioral assertions run normally compiled Windows guest code, not API mocks. */
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT, type Headless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { importsCoverage } from '../../tools/x86/imports-coverage.mjs';
let h: Headless;
beforeAll(async () => {
  buildGame('examples/x64-sysdlls', { quiet: true });
  h = await loadHeadless('x64-sysdlls'); await h.stepAsync(80);
}, 120_000);
const cases = [
  'avrt-wide-pointer','avrt-name','avrt-pointer','avrt-index','avrt-task','avrt-duplicate','avrt-priority','avrt-priority-invalid','avrt-thread-owner','avrt-revert','avrt-stale',
  'rng-system','rng-pseudo-handle','rng-empty','rng-null','rng-flags','rng-provider','rng-no-provider','rng-wide-pointer','rng-span','rng-entropy-flag',
  'dwm-wide-pointer','dwm-composition','dwm-pointer','dwm-blur','dwm-flush','dwm-window',
  'ime-absent','ime-disassociate','ime-invalid-context','ime-release','ime-composition','ime-window',
  'ip-wide-pointer','ip-adapters','ip-empty-list','ip-family','ip-size-pointer','ip-route','ip-route-family','path-wide-pointer','path-self','path-missing',
  'di-version','di-create','di-identity','di-refcount','di-interface','di-callback','di-enumerate','di-no-forcefeedback','di-keyboard','di-mouse','di-device-identity',
  'di-ansi','di-release','di-pad-absent','di-pad-discovery','di-caps','di-info','di-cooperative','di-exclusive','di-format-axis-mode','di-format-missing-object','di-format-reserved-type','di-format','di-not-acquired','di-acquire','di-acquire-again','di-state-size','di-format-acquired',
  'di-wide-pointer','di-file-unsupported','di-poll','di-unsupported','di-status','di-unacquire','di-live-keyboard','di-live-mouse',
  'wsa-wide-pointer','wsa-restart','wsa-not-started','wsa-version-reject','wsa-v1-layout','wsa-v2-layout','wsa-v21-negotiation','wsa-nesting','wsa-cleanup',
  'socket-family','socket-type','socket-handle','socket-byte-order','socket-inet-addr','socket-connect','socket-wsaconnect',
  'socket-bind-nonlocal','socket-bind','socket-name','socket-listen','socket-nonblocking','socket-accept','socket-option','socket-send','socket-recv',
  'socket-sendto','socket-datagram-sendto','socket-recvfrom','socket-fdset','socket-select','socket-close','socket-datagram-bind','socket-offline-blocking','socket-datagram-nonblocking',
  'socket-wide-pointer','socket-ephemeral-collision','socket-cooperative-worker','socket-ipv6','socket-invalid-address','socket-addrinfo','socket-addrinfo-list','socket-nameinfo','socket-freeaddr','socket-no-dns',
];
it.each(cases)('%s contract: catches wrong result/error/output or layout', name => {
  expect(h.logs, h.logs.join('\n')).toContain(`guest: sysdlls PASS ${name}`);
});
it('normal fixture reaches READY, no stubs or interpretation', () => {
  expect(h.logs, h.logs.join('\n')).toContain('guest: sysdlls READY');
  expect((h.host.metrics() as any).interp_insns).toBe(0);
  expect((h.host.metrics() as any).stubs).toEqual([]);
});
it('DirectInput snapshots reflect BGT key and relative pointer changes', async () => {
  h.key('KeyK', true); h.pointer(100, 90, 1); await h.stepAsync(2);
  expect(h.logs.some(s => s.includes('key=128') && s.includes('button=128'))).toBe(true);
  h.key('KeyK', false); h.pointer(107, 86, 0); await h.stepAsync(1);
  expect(h.logs).toContain('guest: sysdlls input key=0 mouse=7,-4 button=0');
});
it('DirectInput gamepad discovery, data format and disconnected-device errors', async () => {
  h.input.gamepads=[{connected:true,buttons:1|(1<<12)|(1<<15),axes:[16384,-8192,0,0],triggers:[0,0]}];
  await h.stepAsync(2);
  expect(h.logs).toContain('guest: sysdlls PASS di-pad-acquire');
  expect(h.logs).toContain('guest: sysdlls PASS di-pad-subset');
  expect(h.logs).toContain('guest: sysdlls subset y=24575');
  expect(h.logs).toContain('guest: sysdlls pad x=49151 y=24575 button=128 pov=4500 absent=4294967295');
  h.input.gamepads[0].axes=[32767,-32767,0,0];await h.stepAsync(2);
  expect(h.logs).toContain('guest: sysdlls pad x=65535 y=0 button=128 pov=4500 absent=4294967295');
  h.input.gamepads[0].connected=false;await h.stepAsync(2);
  expect(h.logs).toContain('guest: sysdlls PASS di-pad-disconnect');
});
it('every DirectInput COM vtable slot has its Windows stdcall arity, including unsupported methods', () => {
  const source=readFileSync(join(ROOT,'platforms/win32/w32_dinput8.c'),'utf8');
  const arities=new Map([...source.matchAll(/API\("([^"]+)",(\d+),/g)].map(m=>[m[1],Number(m[2])]));
  const root=source.match(/const char \*root\[\]=\{([^}]+)\}/)![1].match(/"[^"]+"/g)!.map(n=>n.slice(1,-1));
  expect(root.map(n=>arities.get(n))).toEqual([3,1,1,4,5,2,3,3,4,6,5]);
  const declared=source.match(/const uint8_t nargs\[32\]=\{([^}]+)\}/)![1].split(',').map(Number);
  expect(declared).toEqual([3,1,1,2,4,3,3,1,1,3,5,2,2,3,4,2,3,4,5,4,3,2,2,4,2,1,5,5,5,4,4,2]);
  const named=source.match(/methods\[32\]=\{([^}]+)\}/)![1];
  for(const [,slot,name] of named.matchAll(/\[(\d+)\]="([^"]+)"/g)) expect(arities.get(name),name).toBe(declared[Number(slot)]);
  for(const n of [2,3,4,5,6]) expect(arities.get(`K1DiUnsupported${n}`)).toBe(n);
});
it('all nine DLL namespaces are registered and every target export is covered', () => {
  const dir = join(ROOT, 'node_modules/.cache/bgt/pipeline/x64-sysdlls/fixture/sysdlls.exe');
  const coverage = importsCoverage(dir);
  const dlls = ['avrt','bcrypt','dinput8','dwmapi','imm32','iphlpapi','shlwapi','ws2_32','wsock32'];
  for (const dll of dlls) {
    const entries = coverage.imports.filter((e: any) => e.dll.toLowerCase() === `${dll}.dll`);
    expect(entries.length, dll).toBeGreaterThan(0);
    expect(entries.every((e: any) => e.status === 'implemented'), JSON.stringify(entries)).toBe(true);
  }
  const manifest = JSON.parse(readFileSync(join(ROOT,'web/public/games/x64-sysdlls/manifest.json'),'utf8'));
  expect(manifest.pipeline.exceptions.overrides).toEqual([]);
});
it('300-frame oracle: identical, null errors, fully lifted, no success stubs', async () => {
  buildGame('examples/x64-sysdlls', { interpretOnly: true, quiet: true });
  const r = await oracle('x64-sysdlls', 300);
  expect(r.identical).toBe(true); expect(r.errors).toEqual({lifted:null,interpreted:null});
  expect((r.metrics.lifted as any).interp_insns).toBe(0);
  expect((r.metrics.lifted as any).stubs).toEqual([]);
}, 120_000);
