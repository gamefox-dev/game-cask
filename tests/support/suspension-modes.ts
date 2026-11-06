import {jspiApi} from '../../bgt/runtime/jspi';

// Asyncify is unconditional; JSPI is optional only when the caller has not
// explicitly required it. Never turn a required-mode run into partial coverage.
export function testSuspensionModes(supported=!!jspiApi(),required=process.env.BGT_TEST_JSPI==='1'):('asyncify'|'jspi')[] {
 if(required&&!supported)throw new Error('JSPI required by BGT_TEST_JSPI but WebAssembly.Suspending/promising are unavailable');
 return ['asyncify',...(supported?['jspi' as const]:[])];
}
