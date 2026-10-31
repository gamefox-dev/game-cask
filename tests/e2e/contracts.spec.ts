import { test, expect, openGame, assertBackend, step, input, diagnostics, catches } from './fixtures';

test('normal Win64 startup and DLL/FILE contracts produce known results on the browser runtime', async ({ page, backendParam, collector }, info) => {
  catches('wrong FILE layout, DLL outputs/errors, callback ABI, raw-device layout or fatal startup path');
  collector.allow(/guest CRT/);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  expect(await openGame(page, backendParam, { game: 'x64-contracts' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for(let i=0;i<100&&!logs.some((s)=>s.endsWith('tracking ready'));i++)await step(page,1);
  expect(logs.some((s)=>s.endsWith('tracking ready'))).toBe(true);
  await input(page,[{type:'pointer',x:20,y:20,buttons:0}]);
  await step(page,10);
  await input(page,[{type:'pointer',x:350,y:250,buttons:0}]);
  await step(page,300);
  expect(logs.filter((s) => s.endsWith('tracking hover'))).toHaveLength(1);
  expect(logs.filter((s) => s.endsWith('tracking leave'))).toHaveLength(1);
  expect(logs.filter((s) => /contract .* FAIL|missing |BAD_/.test(s))).toEqual([]);
  expect(logs.some((s) => /contracts totals checks=\d+ failures=0/.test(s)), logs.join('\n')).toBe(true);
  expect(logs.filter((s) => /contract .* PASS/.test(s)).length).toBeGreaterThanOrEqual(133);
  expect(logs.some((s) => s.includes('guest CRT fatal runtime error'))).toBe(true);
  const d = await diagnostics(page);
  expect(d.errors).toEqual([]);
  expect(d.commandErrors.count).toBe(0);
  expect((d.metrics as any).interp_insns).toBe(0);
  expect((d.metrics as any).exited).toBe(1);
  expect((d.metrics as any).stubs).toEqual([]);
});
