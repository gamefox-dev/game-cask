import { test, expect, openGame, assertBackend, step, input, debugState, readPixels, diagnostics, attachScreenshot } from './fixtures';

test('resource separator flags/height and dialog caption style buttons are rendered and close through input', async ({ page, backendParam, collector }, info) => {
  collector.allow(/guest:/);
  expect(await openGame(page, backendParam, {game:'win32-hello'})).toBe('ready');
  await assertBackend(page, backendParam, info); await step(page,5);
  const click = async (rect: number[]) => {
    const x=rect[0]+Math.floor(rect[2]/2), y=rect[1]+Math.floor(rect[3]/2);
    await input(page,[{type:'pointer',x,y,buttons:1}]); await step(page,1);
    await input(page,[{type:'pointer',x,y,buttons:0}]); await step(page,2);
  };
  await click((await debugState(page)).ui.menubar.items[0].rect);
  const popup=(await debugState(page)).ui.popup;
  const sep=popup.items.find((i: any)=>i.separator);
  expect(sep.flags & 0x800).toBe(0x800); expect(sep.rect[3]).toBe(8);
  await click(sep.rect);
  expect((await debugState(page)).ui.popup).not.toBeNull();
  await click(popup.items[1].rect);
  const dlg=(await debugState(page)).ui.windows.find((w: any)=>w.dialog);
  expect(dlg.style & 0x82000).toBe(0x82000); // WS_SYSMENU + DS_CONTEXTHELP
  const px=await readPixels(page), d=await diagnostics(page), scale=d.letterbox.w/d.logical.width;
  const at=(x: number,y: number)=>{
    const o=4*(Math.floor(d.letterbox.y+(y+0.5)*scale)*px.width+Math.floor(d.letterbox.x+(x+0.5)*scale));
    return [...px.data.subarray(o,o+3)];
  };
  expect(at(dlg.rect[0]+dlg.rect[2]-16,dlg.rect[1]+3)).toEqual([255,255,255]);
  expect(at(dlg.rect[0]+dlg.rect[2]-30,dlg.rect[1]+3)).toEqual([255,255,255]);
  await attachScreenshot(page,info,'caption-style.png');
  await click([dlg.rect[0]+dlg.rect[2]-16,dlg.rect[1]+3,12,12]);
  expect((await debugState(page)).ui.windows.some((w: any)=>w.dialog)).toBe(false);
});
