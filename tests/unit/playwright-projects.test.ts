// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0. K66 (Q121): every WebGL2 Playwright project honours BGT_WEBGL2_GPU=1.
// Catches: the port-webgl2 project staying on SwiftShader (headless shell, no args) when the native GPU was
// requested, as chromium-webgl2 (K51) and port-engine (K59) already do, or a different channel/launch.
import { expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webglGpuArgs } from '../e2e/browser-options';
type Project = { name: string; use: { channel?: string; launchOptions?: { args: string[] }; backendParam?: string } };
const FLAGS = ['BGT_PORT_TESTS', 'BGT_WEBGL2_GPU', 'BGT_SOFTWARE_RENDERER', 'BGT_E2E_NO_WEBGPU'];
async function projects(env: Record<string, string>, engine = false): Promise<Record<string, Project>> {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-pw-projects-')), cwd = process.cwd(), saved = { ...process.env };
  mkdirSync(join(dir, 'port/tests'), { recursive: true });
  writeFileSync(join(dir, 'port/game.json'), JSON.stringify(engine ? { id: 'cc0', engineProfile: { allowed: true } } : { id: 'cc0', pipeline: {} }));
  try {
    for (const k of FLAGS) delete process.env[k];
    Object.assign(process.env, { BGT_PORT_TESTS: '1', ...env });
    process.chdir(dir); vi.resetModules();
    const config = (await import('../../playwright.config')).default as { projects: Project[] };
    return Object.fromEntries(config.projects.map((p) => [p.name, p]));
  } finally {
    process.chdir(cwd);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); rmSync(dir, { recursive: true, force: true });
  }
}
const launch = (p: Project) => ({ channel: p.use.channel, args: p.use.launchOptions?.args });
it('BGT_WEBGL2_GPU=1 puts port-webgl2 on the native GPU exactly like chromium-webgl2', async () => {
  const p = await projects({ BGT_WEBGL2_GPU: '1' });
  expect(launch(p['port-webgl2'])).toEqual({ channel: undefined, args: webglGpuArgs });
  expect(launch(p['port-webgl2'])).toEqual(launch(p['chromium-webgl2']));
  expect(p['port-webgl2'].use.backendParam).toBe('webgl2');
  expect(launch(p['port-webgpu']).channel).toBe('chromium'); // unchanged WebGPU project
});
it('default and software launches are unchanged and shared', async () => {
  const d = await projects({});
  expect(launch(d['port-webgl2'])).toEqual({ channel: undefined, args: undefined }); // headless-shell SwiftShader gate
  expect(launch(d['port-webgl2'])).toEqual(launch(d['chromium-webgl2']));
  const s = await projects({ BGT_WEBGL2_GPU: '1', BGT_SOFTWARE_RENDERER: '1' });
  expect(launch(s['port-webgl2'])).toEqual(launch(s['chromium-webgl2']));
  expect(launch(s['port-webgl2']).args).toContain('--use-angle=swiftshader');
});
it('engine ports keep the K59 port-engine switch', async () => {
  expect(launch((await projects({ BGT_WEBGL2_GPU: '1' }, true))['port-engine']).args).toEqual(webglGpuArgs);
  expect(launch((await projects({}, true))['port-engine']).args).toContain('--use-angle=swiftshader');
});
