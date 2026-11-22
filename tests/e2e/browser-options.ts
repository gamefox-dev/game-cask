// Keep project and secondary-browser launches consistent. Metal is macOS-only; forcing it on
// Linux can make Dawn's requestAdapter reject with "external Instance ... no longer exists".
const swiftShader = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const noWebGPU = process.env.BGT_E2E_NO_WEBGPU === '1';
const withoutWebGPU = [...swiftShader, '--disable-webgpu', '--disable-features=WebGPU'];
export const webgpuArgs = noWebGPU ? withoutWebGPU : [
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist',
];
export const webglArgs = noWebGPU ? withoutWebGPU : swiftShader;
/** K51: BGT_WEBGL2_GPU=1 runs the chromium-webgl2 project on the native GPU (ANGLE Metal on macOS) instead of the
 * headless-shell SwiftShader default. Opt-in: the default WebGL2 project remains the software CI gate. */
export const webgl2Gpu = process.env.BGT_WEBGL2_GPU === '1' && !noWebGPU && process.env.BGT_SOFTWARE_RENDERER !== '1';
export const webglGpuArgs = [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'];

/** WebGL2 launch for kit/port projects (K51; K66 Q121: port-webgl2 uses it too). Default: the headless-shell
 * launch (SwiftShader, the software CI gate); BGT_E2E_NO_WEBGPU=1 or BGT_SOFTWARE_RENDERER=1 force SwiftShader
 * explicitly; BGT_WEBGL2_GPU=1 runs on the native GPU (ANGLE Metal on macOS). The channel is the default
 * (headless shell) in every case, as for chromium-webgl2. Pure: env in, Playwright `use` fields out. */
export function webgl2Launch(env: Record<string, string | undefined> = process.env): { launchOptions?: { args: string[] } } {
  const off = env.BGT_E2E_NO_WEBGPU === '1', software = off || env.BGT_SOFTWARE_RENDERER === '1';
  const gpu = env.BGT_WEBGL2_GPU === '1' && !software;
  const sw = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(off ? ['--disable-webgpu', '--disable-features=WebGPU'] : [])];
  return software ? { launchOptions: { args: sw } } : gpu ? { launchOptions: { args: webglGpuArgs } } : {};
}
