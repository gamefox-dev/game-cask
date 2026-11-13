// WebAssembly JSPI is deliberately opt-in. Runtime selection falls back to Asyncify.
export interface WasmArtifact { url: string; size: number; sha256: string }
interface JspiApi {
  Suspending: new (fn: (...args: number[]) => Promise<void>) => WebAssembly.ImportValue;
  promising: (fn: (dt: number) => void) => (dt: number) => Promise<void>;
}
export function jspiApi(): JspiApi | null {
  const api = WebAssembly as typeof WebAssembly & Partial<JspiApi>;
  return typeof api.Suspending === 'function' && typeof api.promising === 'function' ? api as typeof WebAssembly & JspiApi : null;
}
export interface SuspensionManifest { wasm: WasmArtifact; suspension?: 'jspi'; preferredSuspension?: 'jspi'; variants?: { jspi?: WasmArtifact } }
export interface SuspensionCapabilities { requested: string; supported: boolean; variantPresent: boolean }
/** Effective request and both prerequisites: explain optional fallback without changing loader policy. */
export function suspensionCapabilities(manifest: SuspensionManifest, requested?: string | null, supported = !!jspiApi()): SuspensionCapabilities {
  return { requested: requested ?? manifest.preferredSuspension ?? manifest.suspension ?? 'asyncify',
    supported, variantPresent: manifest.suspension === 'jspi' || !!manifest.variants?.jspi };
}
export function selectWasmVariant(manifest: SuspensionManifest, requested: string | null | undefined, supported = !!jspiApi()): { artifact: WasmArtifact; mode: 'asyncify' | 'jspi' } {
  if (manifest.suspension === 'jspi') {
    if (!supported) throw new Error('JSPI-only build requires WebAssembly.Suspending/promising; rebuild with suspensionBuild: dual for Asyncify fallback');
    if (requested === 'asyncify') throw new Error('Asyncify requested but this JSPI-only build has no fallback artifact');
    return { artifact: manifest.wasm, mode: 'jspi' };
  }
  return (requested ?? manifest.preferredSuspension) === 'jspi' && supported && manifest.variants?.jspi
    ? { artifact: manifest.variants.jspi, mode: 'jspi' }
    : { artifact: manifest.wasm, mode: 'asyncify' };
}
