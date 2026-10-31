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
