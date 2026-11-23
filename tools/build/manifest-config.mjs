// vK71: build-time validation of the game.json "gpu" section, which build.mjs copies into the manifest verbatim.
// The runtime reads gpu.budgetBytes (§13 reservation budget, ABI.md) and gpu.recoveryShadows (K71, texture recovery
// shadow opt-out, docs/performance.md). An unknown key is a typo the runtime would silently ignore, so it fails.
export const GPU_CONFIG_KEYS = ['budgetBytes', 'recoveryShadows'];
const MIB = 1024 * 1024;

export function validateGpuConfig(gpu) {
  if (gpu === undefined) return;
  if (gpu === null || typeof gpu !== 'object' || Array.isArray(gpu)) throw new Error('game.json "gpu" must be an object');
  const unknown = Object.keys(gpu).filter((k) => !GPU_CONFIG_KEYS.includes(k));
  if (unknown.length) throw new Error(`game.json "gpu" has unknown key(s) ${unknown.map((k) => JSON.stringify(k)).join(', ')}; known: ${GPU_CONFIG_KEYS.join(', ')}`);
  if (gpu.recoveryShadows !== undefined && typeof gpu.recoveryShadows !== 'boolean') throw new Error('game.json gpu.recoveryShadows must be a boolean');
  if (gpu.budgetBytes !== undefined && !(Number.isInteger(gpu.budgetBytes) && gpu.budgetBytes >= 16 * MIB && gpu.budgetBytes <= 0xffffffff))
    throw new Error('game.json gpu.budgetBytes must be an integer from 16 MiB through 0xffffffff');
}
