// Structured checkpoint file codec. Files are private test artifacts, not guest saves.
import type { Savestate } from './savestates';
import { encodeBytes, decodeBytes } from '../renderers/recording';
export function exportSavestate(state: Savestate): string {
  return JSON.stringify(state, (_key, v: unknown) => {
    if (typeof v === 'bigint') return {$bgt:'bigint',data:v.toString()};
    if (typeof v === 'number' && !Number.isFinite(v)) {
      const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,v,true);
      return {$bgt:'f64',data:encodeBytes(bytes)};
    }
    if (typeof v === 'number' && Object.is(v,-0)) return {$bgt:'negative-zero'};
    if (v instanceof Map) return {$bgt:'map',data:[...v]};
    if (v instanceof Set) return {$bgt:'set',data:[...v]};
    if (v instanceof Uint8Array) return {$bgt:'u8',data:encodeBytes(v)};
    if (v instanceof Uint32Array) return {$bgt:'u32',data:[...v]};
    return v;
  });
}
export function importSavestate(file: string): Savestate {
  const state: Savestate = JSON.parse(file, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || !('$bgt' in v)) return v;
    const tagged = v as {$bgt:string;data:never};
    switch (tagged.$bgt) {
      case 'f64': {const b=decodeBytes(tagged.data);if(b.length!==8)throw new Error('Invalid float bits');return new DataView(b.buffer).getFloat64(0,true);}
      case 'bigint':return BigInt(tagged.data);
      case 'negative-zero':return -0;
      case 'map':return new Map(tagged.data);
      case 'set':return new Set(tagged.data);
      case 'u8':return decodeBytes(tagged.data);
      case 'u32':return new Uint32Array(tagged.data);
      default:throw new Error('Unsupported savestate value');
    }
  });
  if (state.schema !== 'bgt-savestate/1') throw new Error('Unsupported savestate file');
  return state;
}
