// Read-only, best-effort machine snapshot. Denied platform commands are explicit, never fake zeros.
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
export function resourceSnapshot() {
  const errors=[];
  const command=(name,args)=>{try{return execFileSync(name,args,{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','pipe']}).trim();}catch(e){errors.push(`${name}: ${e.message}`);return null;}};
  let swapUsedBytes=null;
  if(process.platform==='darwin') {
    const s=command('sysctl',['-n','vm.swapusage']);
    const m=s?.match(/used\s*=\s*([\d.]+)M/);if(m)swapUsedBytes=Math.round(Number(m[1])*1024*1024);
  } else if(process.platform==='linux') {
    try {const s=readFileSync('/proc/meminfo','utf8');swapUsedBytes=(Number(s.match(/SwapTotal:\s*(\d+)/)?.[1])-Number(s.match(/SwapFree:\s*(\d+)/)?.[1]))*1024;}catch(e){errors.push(String(e));}
  }
  const ps=command('ps',['-axo','pid=,pcpu=,rss=,comm=']);
  const topCpuProcesses=ps?.split('\n').map(s=>s.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
    .map(m=>({pid:Number(m[1]),cpuPercent:Number(m[2]),rssBytes:Number(m[3])*1024,command:m[4]})).sort((a,b)=>b.cpuPercent-a.cpuPercent).slice(0,10) ?? null;
  const legacy=existsSync('/tmp/bgt-heavy-queue');
  const prefix=process.env.BGT_HEAVY_LOCK_PREFIX ?? (legacy?'/tmp/bgt-heavy':'/tmp/bgt-heavy-v1');
  let gate=null;
  try {
    const slotsFile=process.env.BGT_HEAVY_SLOTS_FILE ?? `${prefix}-slots`;
    const slots=Number(existsSync(slotsFile)?readFileSync(slotsFile,'utf8').trim():process.env.BGT_HEAVY_SLOTS ?? (legacy?3:2));
    const status=command('python3',['-I','-c',`import fcntl,os,json,sys
p=sys.argv[1]; out=[]
for i in range(1,int(sys.argv[2])+1):
 path=p+'-slot-'+str(i)+'.lock'
 if not os.path.exists(path):out.append(False);continue
 with open(path,'r+') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.lockf(f,fcntl.LOCK_EX|fcntl.LOCK_NB);out.append(False)
  except BlockingIOError:out.append(True)
print(json.dumps(out))`,prefix,String(slots)]);
    gate={slots,occupied:status?JSON.parse(status):null,queued:existsSync(`${prefix}-queue`)?readdirSync(`${prefix}-queue`).length:0};
  }catch(e){errors.push(String(e));}
  return {when:new Date().toISOString(),platform:`${process.platform}/${process.arch}`,cpuCount:os.cpus().length,
    cpuModel:os.cpus()[0]?.model,loadAverage:os.loadavg(),freeRamBytes:os.freemem(),totalRamBytes:os.totalmem(),swapUsedBytes,
    heavyGate:gate,topCpuProcesses,errors};
}
