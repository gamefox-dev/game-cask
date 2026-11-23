// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
// K71 (Q131): the footprint tool's parsing, ownership and fit math (no browser, no `footprint` run).
// Breakage caught: a unit or column misread (KB vs MB, the TOTAL row counted as a category), phys_footprint lost,
// JSON scale ignored, another session's browser counted (ownership by name instead of the environment tag), a
// Chromium/WebKit process given the wrong role (renderer vs GPU), the page renderer not the largest renderer, and
// wrong slope/intercept.
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped kit tool module
import * as F from '../../tools/report/footprint.mjs';

const KB = 1024, MB = 1024 * 1024;
// Synthetic output in the shape `footprint -p PID` prints (formatted units); no captured process data.
const text = `======================================================================
Example Renderer [101]: 64-bit    Footprint: 1722 MB (16384 bytes per page)
======================================================================

  Dirty      Clean  Reclaimable    Regions    Category
    ---        ---          ---        ---    ---
 967 MB        0 B          0 B        120    tag 16
 712 MB        0 B          0 B         40    tag 14
  43 MB     1.5 MB       256 KB         12    MALLOC_SMALL
    0 B      13 MB          0 B         39    mapped file
    ---        ---          ---        ---    ---
1722 MB    14.5 MB       256 KB        211    TOTAL

Auxiliary data:
    phys_footprint: 1730 MB
    phys_footprint_peak: 1.8 GB

======================================================================
helper [202]: 64-bit    Footprint: 848 B (16384 bytes per page)
======================================================================

  Dirty      Clean  Reclaimable    Regions    Category
    ---        ---          ---        ---    ---
  848 B        0 B          0 B          1    __AUTH
    ---        ---          ---        ---    ---
  848 B        0 B          0 B          1    TOTAL
`;

describe('K71 footprint tool', () => {
  it('parses formatted sizes in binary units', () => {
    expect(F.parseSize('848 B')).toBe(848);
    expect(F.parseSize('1296 KB')).toBe(1296 * KB);
    expect(F.parseSize('1.5 MB')).toBe(1.5 * MB);
    expect(F.parseSize('1.8 GB')).toBe(Math.round(1.8 * 1024 * MB));
    expect(() => F.parseSize('12 parsecs')).toThrow(/unparsable/);
  });

  it('parses footprint text: per process, categories without TOTAL, phys_footprint aux data', () => {
    const p = F.parseFootprintText(text);
    expect(p.map((x: { pid: number }) => x.pid)).toEqual([101, 202]);
    expect(p[0]).toMatchObject({ name: 'Example Renderer', footprintBytes: 1722 * MB, physFootprintBytes: 1730 * MB,
      physFootprintPeakBytes: Math.round(1.8 * 1024 * MB) });
    expect(p[0].categories.map((c: { name: string }) => c.name)).toEqual(['tag 16', 'tag 14', 'MALLOC_SMALL', 'mapped file']);
    expect(p[0].categories[2]).toMatchObject({ dirty: 43 * MB, clean: 1.5 * MB, reclaimable: 256 * KB, regions: 12 });
    expect(p[1]).toMatchObject({ footprintBytes: 848, physFootprintBytes: null, categories: [{ name: '__AUTH', dirty: 848 }] });
  });

  it('parses footprint --json output with its unit scale', () => {
    const json = { unit: 'page', 'bytes per unit': 16384, processes: [{ name: 'x', pid: 7, footprint: 10,
      categories: { a: { dirty: 2, swapped: 1, clean: 0, reclaimable: 0, wired: 0, regions: 3 }, b: { dirty: 5, swapped: 0, clean: 1, reclaimable: 0, wired: 0, regions: 1 } },
      auxiliary: { phys_footprint: 11, phys_footprint_peak: 12 } }] };
    expect(F.parseFootprintJson(JSON.stringify(json))).toEqual([{ pid: 7, name: 'x', footprintBytes: 10 * 16384,
      physFootprintBytes: 11 * 16384, physFootprintPeakBytes: 12 * 16384, categories: [
        { name: 'b', dirty: 5 * 16384, clean: 16384, reclaimable: 0, swapped: 0, regions: 1 },
        { name: 'a', dirty: 2 * 16384, clean: 0, reclaimable: 0, swapped: 16384, regions: 3 }] }]);
  });

  it('classifies Chromium and WebKit processes by role', () => {
    const chrome = '/x/ms-playwright/chromium-1/chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Helpers/Google Chrome for Testing Helper';
    expect(F.classifyProcess('/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless')).toEqual({ engine: 'chromium', role: 'browser' });
    expect(F.classifyProcess(`${chrome} (Renderer).app/x --type=renderer --lang=en`)).toEqual({ engine: 'chromium', role: 'renderer' });
    expect(F.classifyProcess(`${chrome} (GPU).app/x --type=gpu-process`)).toEqual({ engine: 'chromium', role: 'gpu' });
    expect(F.classifyProcess(`${chrome}.app/x --type=utility --utility-sub-type=network.mojom.NetworkService`)).toEqual({ engine: 'chromium', role: 'network' });
    expect(F.classifyProcess(`${chrome}.app/x --type=utility --utility-sub-type=storage.mojom.StorageService`)).toEqual({ engine: 'chromium', role: 'utility' });
    expect(F.classifyProcess('/x/chrome_crashpad_handler --monitor-self')).toEqual({ engine: 'chromium', role: 'other' });
    const wk = '/x/ms-playwright/webkit-2/';
    expect(F.classifyProcess(`${wk}com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent.Development`)).toEqual({ engine: 'webkit', role: 'renderer' });
    expect(F.classifyProcess(`${wk}com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU.Development`)).toEqual({ engine: 'webkit', role: 'gpu' });
    expect(F.classifyProcess(`${wk}com.apple.WebKit.Networking.xpc/Contents/MacOS/x`)).toEqual({ engine: 'webkit', role: 'network' });
    expect(F.classifyProcess(`${wk}Playwright.app/Contents/MacOS/Playwright --inspector-pipe`)).toEqual({ engine: 'webkit', role: 'browser' });
    expect(F.classifyProcess(`bash ${wk}pw_run.sh --inspector-pipe`)).toEqual({ engine: 'webkit', role: 'launcher' });
    expect(F.classifyProcess('/usr/bin/vim')).toEqual({ engine: null, role: 'other' });
  });

  it('owns only processes whose environment carries this session tag (XPC services included)', () => {
    const tag = 'abcdef0123456789';
    expect(F.ownershipEnv(tag)).toEqual({ BGT_FOOTPRINT_TAG: tag, __XPC_BGT_FOOTPRINT_TAG: tag });
    expect(() => F.ownershipEnv('x y')).toThrow();
    const env = [
      `  11 /x/Chrome --type=renderer HOME=/h BGT_FOOTPRINT_TAG=${tag} __XPC_BGT_FOOTPRINT_TAG=${tag}`,
      `  12 /x/com.apple.WebKit.WebContent.Development PATH=/bin BGT_FOOTPRINT_TAG=${tag}`, // launchd stripped __XPC_
      '  13 /x/com.apple.WebKit.WebContent.Development BGT_FOOTPRINT_TAG=someoneelse0000',
      `  14 /x/Chrome --type=gpu-process __XPC_BGT_FOOTPRINT_TAG=${tag}`, // only the prefixed copy: not ours
      `  15 /x/Chrome BGT_FOOTPRINT_TAG=${tag}x`,
    ].join('\n');
    expect(F.taggedPids(env, tag)).toEqual([11, 12]);
    expect(F.parsePs('  1   0 /sbin/launchd\n 42  1 /x/y --a b\n')).toEqual([{ pid: 1, ppid: 0, command: '/sbin/launchd' }, { pid: 42, ppid: 1, command: '/x/y --a b' }]);
  });

  it('summarizes by role; the page renderer is the largest renderer', () => {
    const p = (pid: number, bytes: number) => ({ pid, name: String(pid), footprintBytes: bytes - 1, physFootprintBytes: bytes, physFootprintPeakBytes: null, categories: [] });
    const rows = [{ pid: 1, ppid: 0, command: '/x/Chrome --type=renderer' }, { pid: 2, ppid: 0, command: '/x/Chrome --type=renderer' },
      { pid: 3, ppid: 0, command: '/x/Chrome --type=gpu-process' }, { pid: 4, ppid: 0, command: '/x/Chrome' }];
    const s = F.summarizeFootprint([p(1, 30 * MB), p(2, 900 * MB), p(3, 400 * MB), p(4, 80 * MB)], rows);
    expect(s).toMatchObject({ totalBytes: 1410 * MB, pageRendererBytes: 900 * MB, gpuProcessBytes: 400 * MB,
      byRole: { renderer: 930 * MB, gpu: 400 * MB, browser: 80 * MB } });
    expect(s.processes[0]).toMatchObject({ pid: 2, role: 'renderer', engine: 'chromium' });
  });

  it('fits footprint per MB of wasm', () => {
    const f = F.linearFit([{ x: 1, y: 103 }, { x: 33, y: 167 }, { x: 65, y: 231 }]);
    expect(f.slope).toBeCloseTo(2, 10); expect(f.intercept).toBeCloseTo(101, 10); expect(f.r2).toBeCloseTo(1, 10);
    expect(() => F.linearFit([{ x: 1, y: 1 }])).toThrow(/two points/);
    expect(() => F.linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toThrow(/distinct/);
    const snap = (wasm: number, renderer: number, gpu: number, estimate: number) => ({ label: 'run', estimate: { wasmModuleBytes: wasm * MB, totalBytes: estimate * MB },
      footprint: { pageRendererBytes: renderer * MB, gpuProcessBytes: gpu * MB }, unattributedBytes: (renderer + gpu - estimate) * MB });
    const sweep = F.sweepFit([{ game: 'a', snapshots: [snap(1, 120, 50, 60)] }, { game: 'b', snapshots: [snap(11, 160, 50, 70)] }]);
    expect(sweep.fits.renderer.slope).toBeCloseTo(4, 10);
    expect(sweep.fits.rendererPlusGpu.intercept).toBeCloseTo(166, 10);
    expect(sweep.fits.unattributed.slope).toBeCloseTo(3, 10);
    expect(sweep.points.map((x: { game: string }) => x.game)).toEqual(['a', 'b']);
  });
});
