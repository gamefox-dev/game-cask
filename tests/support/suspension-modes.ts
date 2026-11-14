import {jspiApi} from '../../bgt/runtime/jspi';
import type {SuspensionCapabilities} from '../../bgt/runtime/jspi';

/** Null means real JSPI coverage; otherwise name every missing prerequisite. */
export function jspiUnavailableReason(capability: Pick<SuspensionCapabilities,'supported'|'variantPresent'>, required=process.env.BGT_TEST_JSPI==='1'): string | null {
 const missing = [
  ...(!capability.supported ? ['browser WebAssembly.Suspending/promising APIs'] : []),
  ...(!capability.variantPresent ? ['artifact JSPI variant (manifest.variants.jspi or JSPI-only manifest.suspension)'] : []),
 ];
 if(!missing.length)return null;
 const reason='JSPI unavailable: missing '+missing.join(' and ');
 if(required)throw new Error('JSPI required by BGT_TEST_JSPI: '+reason);
 return reason;
}

// Asyncify is unconditional; JSPI is optional only when the caller has not
// explicitly required it. Never turn a required-mode run into partial coverage.
export function testSuspensionModes(supported=!!jspiApi(),required=process.env.BGT_TEST_JSPI==='1'):('asyncify'|'jspi')[] {
 if(required&&!supported)throw new Error('JSPI required by BGT_TEST_JSPI but WebAssembly.Suspending/promising are unavailable');
 return ['asyncify',...(supported?['jspi' as const]:[])];
}
