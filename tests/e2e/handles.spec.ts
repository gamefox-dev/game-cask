import { test, expect, openGame, assertBackend, step, diagnostics, stateHash, catches } from './fixtures';
for(const id of ['x64-handles','x86-handles']) {
  test(`${id}: pseudo conversion, owned aliases and mixed waits complete`,async({page,backendParam,collector},info)=>{
    catches('startup abort on current-thread duplication, lost alias ownership/rights or wrong shared file/wait state');
    collector.allow(/guest:|guest stdout:/);
    const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
    expect(await openGame(page,backendParam,{game:id})).toBe('ready');
    await assertBackend(page,backendParam,info);
    const before=await stateHash(page);await step(page,300);
    expect(await stateHash(page)).not.toBe(before);
    expect(logs.some(s=>/handles checks=\d+ failures=0 PASS$/.test(s)),logs.join('\n')).toBe(true);
    expect(logs.filter(s=>s.includes('handle FAIL'))).toEqual([]);
    const d=await diagnostics(page);expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(0);
    expect(d.metrics).toMatchObject({interp_insns:0,stubs:[],exited:1});
  });
}
