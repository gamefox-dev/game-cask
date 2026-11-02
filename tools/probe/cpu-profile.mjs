// Chromium CDP profiles remain valid DevTools .cpuprofile JSON. Mapping lives in a sidecar.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function profileRange(value='0:300') {
  if(!/^\d+:\d+$/.test(value))throw new Error('--cpu-profile requires START:END update frames');
  const [start,end]=value.split(':').map(Number);
  if(!Number.isSafeInteger(end)||end<=start)throw new Error('invalid CPU profile range');
  return {start,end};
}
export function mapProfile(profile) {
  return profile.nodes.map(n=>{
    const name=n.callFrame.functionName;
    const m=name.match(/\b[FR]_([0-9a-f]{8})(?:_([0-9a-f]{8}))?/i);
    return {node:n.id,functionName:name,guestAddress:m?Number.parseInt(m[1],16):null,
      regionAddress:m?.[2]?Number.parseInt(m[2],16):null,wasmFunction:/wasm-function\[(\d+)\]/.exec(name)?.[1] ?? null,
      hitCount:n.hitCount ?? 0};
  });
}
export async function createCpuProfiler(page,range,out,log) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  let active=false,done=false;
  const report=log.cpuProfile={...range,startedFrame:null,endedFrame:null,complete:false,intervalUs:1000};
  async function stop(frame) {
    if(!active)return;
    const {profile}=await cdp.send('Profiler.stop');active=false;done=true;
    const file=join(out,'cpu.cpuprofile'),mapping=join(out,'cpu-mapping.json');
    writeFileSync(file,JSON.stringify(profile)+'\n');
    const nodes=mapProfile(profile);
    writeFileSync(mapping,JSON.stringify({schema:'game-cask/cpu-map/1',nodes},null,2)+'\n');
    Object.assign(report,{endedFrame:frame,complete:frame===range.end,mappedNodes:nodes.filter(n=>n.guestAddress!==null).length,
      unmappedWasmNodes:nodes.filter(n=>n.guestAddress===null && n.wasmFunction!==null).length});
    log.artifacts.push(file,mapping);
  }
  return {
    async step(n,api) {
      if(!Number.isInteger(n)||n<0)throw new Error('profiled step must be a nonnegative integer');
      let frame=(await api('diagnostics')).frame;
      while(n>0) {
        if(!active && !done && frame>=range.start && frame<range.end) {
          await cdp.send('Profiler.start');active=true;report.startedFrame=frame;
        }
        const boundary=frame<range.start?range.start:frame<range.end?range.end:Infinity;
        const count=Math.min(n,boundary-frame);
        await api('step',count);n-=count;
        const next=(await api('diagnostics')).frame;
        if(next<=frame)throw new Error('profiled step made no progress');frame=next;
        if(active && frame>=range.end)await stop(frame);
      }
    },
    async finish(frame) {await stop(frame);await cdp.detach();},
  };
}
