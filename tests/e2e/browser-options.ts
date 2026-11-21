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
