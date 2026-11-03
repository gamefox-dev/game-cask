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
export function selectWasmVariant(manifest: { wasm: WasmArtifact; variants?: { jspi?: WasmArtifact } }, requested: string | null | undefined, supported = !!jspiApi()): { artifact: WasmArtifact; mode: 'asyncify' | 'jspi' } {
  return requested === 'jspi' && supported && manifest.variants?.jspi
    ? { artifact: manifest.variants.jspi, mode: 'jspi' }
    : { artifact: manifest.wasm, mode: 'asyncify' };
}
