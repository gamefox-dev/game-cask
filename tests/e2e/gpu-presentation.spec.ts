import { CommandEncoder } from '../../bgt/runtime/commands';
import { GPU_OP } from '../../bgt/runtime/abi';
import { test, expect, openGame, assertBackend, step, input, diagnostics, debugState, readPixels, diffFraction } from './fixtures';

// The final red square is a legacy draw after GPU screen LOAD; retaining only a GPU attachment loses it.
test('GPU presentation: empty paused captures retain the final mixed 2D/GPU/2D image',
  async ({page,backendParam,collector},info)=>{
    void collector;
    await openGame(page,backendParam,{game:'gpu-scenes',arg0:'7',arg1:'1'});
    await assertBackend(page,backendParam,info);
    for(let i=0;i<40;i++) {
      await step(page,1); await page.waitForTimeout(10);
      if((await debugState(page)).read)break;
    }
    const d=await diagnostics(page), a=await readPixels(page);
    const x=Math.floor(d.letterbox.x+80.5*d.letterbox.w/160);
    const y=Math.floor(d.letterbox.y+60.5*d.letterbox.h/128), i=(y*a.width+x)*4;
    expect([...a.data.subarray(i,i+3)]).toEqual([255,0,0]);
    await step(page,4);
    expect(diffFraction(a,await readPixels(page),0)).toBe(0);
    // A new screen pass with LOAD and no draw must preserve the prior mixed image across frames.
    const load=new CommandEncoder().gpu(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,0,0,0,0,0,0,0])
      .gpu(GPU_OP.PASS_END,[]).finish();
    const result=await page.evaluate(s=>(window as any).__BGT_TEST__.injectCommands(s),
      Buffer.from(load).toString('base64'));
    expect(result.status).toBe(0);
    expect(diffFraction(a,await readPixels(page),0),'cross-frame GPU LOAD').toBe(0);
    await page.setViewportSize({width:800,height:600});
    await page.waitForTimeout(100);
    const resized=await readPixels(page), layout=(await diagnostics(page)).letterbox;
    const at=(x:number,y:number)=>{
      const dx=Math.floor(layout.x+(x+.5)*layout.w/160), dy=Math.floor(layout.y+(y+.5)*layout.h/128);
      return [...resized.data.subarray((dy*resized.width+dx)*4,(dy*resized.width+dx)*4+3)];
    };
    expect(at(80,60),'resize preserves final legacy overlay').toEqual([255,0,0]);
    expect(at(10,10),'resize preserves background').toEqual([30,40,50]);
    expect(at(50,40),'resize preserves GPU pass').toEqual([0,255,0]);
    expect([...resized.data.subarray(0,3)],'new letterbox is black').toEqual([0,0,0]);
    await input(page,[{type:'button',button:'A',down:true}]);
    await step(page,1);
    await input(page,[{type:'button',button:'A',down:false}]);
    const replacement=await readPixels(page);
    const center=(Math.floor(layout.y+layout.h/2)*replacement.width+Math.floor(layout.x+layout.w/2))*4;
    expect([...replacement.data.subarray(center,center+3)],'later 2D-only output replaces the GPU snapshot')
      .toEqual([10,20,30]);
    expect(diffFraction(replacement,await readPixels(page),0)).toBe(0);
    expect((await diagnostics(page)).commandErrors.count).toBe(0);
    expect((await diagnostics(page)).errors).toEqual([]);
  });
