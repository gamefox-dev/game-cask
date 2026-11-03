// Generic deterministic capture driver. With --record-frame N the recorder stops after N;
// this script also steps to N. No game-specific inputs or code.
export default async function (p) {
  const target = Number(p.params.recordTo);
  if (!Number.isSafeInteger(target) || target < 0) throw new Error('--params recordTo=N required');
  const current = (await p.diagnostics()).frame;
  if (target < current) throw new Error('recordTo precedes current update');
  if (target === current) await p.readPixels();
  else await p.step(target - current);
}
