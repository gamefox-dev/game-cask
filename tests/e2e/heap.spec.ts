import { test, expect, openGame, assertBackend, step, diagnostics, stateHash, catches } from './fixtures';
for(const id of ['x64-heap','x86-heap'])test(`${id}: allocator contracts preserve contents, ownership and flags`,async({page,backendParam,collector},info)=>{
  catches('allocator corruption, nonzero growth, wrong requested sizes/ownership, CRT errno, missing heap completion');
  collector.allow(/guest:/);
  const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
  expect(await openGame(page,backendParam,{game:id})).toBe('ready');
  await assertBackend(page,backendParam,info);
  const before=await stateHash(page);await step(page,300);
  expect(await stateHash(page)).not.toBe(before);
  expect(logs.some(s=>/heap checks=\d+ failures=0$/.test(s)),logs.join('\n')).toBe(true);
  expect(logs.filter(s=>s.includes('heap FAIL'))).toEqual([]);
  const d=await diagnostics(page);expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(0);
  expect(d.metrics).toMatchObject({exited:1,interp_insns:0,stubs:[]});
});
