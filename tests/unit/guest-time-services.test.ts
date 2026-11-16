// @bgt-examples: none
// Catch audio draining by host-update count instead of the Win32 clock, or by observation.
import { it, expect } from 'vitest';
import { Savestates } from '../../bgt/runtime/savestates';
import type { BGTRuntime } from '../../bgt/runtime/runtime';
import type { HostServices } from '../../bgt/runtime/host';
it('deterministic audio credits virtual time, not host latency, updates or reads',()=>{
 let us=0;
 const rt={ready:false,host:undefined} as unknown as BGTRuntime;
 new Savestates(rt,1);
 rt.host={guestTimeUs:()=>us} as typeof rt.host;
 const services=rt.testHarness!.services({now:()=>999999} as HostServices);
 const audio=services.audio!;
 expect(audio.push(new Int16Array(4800))).toBe(4800);
 for(let i=0;i<20;i++)rt.testHarness!.updated();
 expect(audio.queued()).toBe(4800);expect(services.guestNow!()).toBe(0);
 us=10000;rt.testHarness!.updated();expect(audio.queued()).toBe(4320);
 us=15000;expect(audio.queued()).toBe(4080);
 for(let i=0;i<10;i++)expect(audio.queued()).toBe(4080);
 expect(services.guestNow!()).toBe(15);
 us=115000;expect(audio.queued()).toBe(0);
});
it('native BGT deterministic audio retains the 16667-us completed-update clock',()=>{
 const rt={ready:false,host:undefined} as unknown as BGTRuntime;
 new Savestates(rt,1);
 const services=rt.testHarness!.services({now:()=>0} as HostServices),audio=services.audio!;
 expect(audio.push(new Int16Array(4800))).toBe(4800);
 rt.testHarness!.updated();expect(audio.queued()).toBe(4000);
 rt.testHarness!.updated();expect(audio.queued()).toBe(3200);
 expect(services.guestNow!()).toBe(33.334);
});
