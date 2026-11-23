// Chromium launch conventions shared by the Playwright projects (tests/e2e/browser-options.ts re-exports these) and
// plain Node tools (K70 Q130: tools/report/package-metrics.mjs). Pure: env in, Playwright launch fields out.
// Metal is macOS-only; forcing it on Linux can make Dawn's requestAdapter reject.
export const webglGpuArgs = [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'];
export const webgpuGpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', ...webglGpuArgs];

/** WebGL2 launch for kit/port projects (K51; K66 Q121: port-webgl2 uses it too). Default: the headless-shell
 * launch (SwiftShader, the software CI gate); BGT_E2E_NO_WEBGPU=1 or BGT_SOFTWARE_RENDERER=1 force SwiftShader
 * explicitly; BGT_WEBGL2_GPU=1 runs on the native GPU (ANGLE Metal on macOS). The channel is the default
 * (headless shell) in every case, as for chromium-webgl2.
 * @param {Record<string, string | undefined>} env
 * @returns {{ launchOptions?: { args: string[] } }} */
export function webgl2Launch(env = process.env) {
  const off = env.BGT_E2E_NO_WEBGPU === '1', software = off || env.BGT_SOFTWARE_RENDERER === '1';
  const gpu = env.BGT_WEBGL2_GPU === '1' && !software;
  const sw = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(off ? ['--disable-webgpu', '--disable-features=WebGPU'] : [])];
  return software ? { launchOptions: { args: sw } } : gpu ? { launchOptions: { args: webglGpuArgs } } : {};
}
