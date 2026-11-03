// Integration boundary: neither entry metrics nor FILE accounting may disappear on merge.
import { expect, it } from 'vitest';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { Vfs } from '../../bgt/runtime/vfs';

it('coverage snapshots retain execution evidence and separate consumed, observed and speculative FILE bytes', () => {
  const vfs = new Vfs();
  vfs.add('input', new Uint8Array(3 * 65536));
  const file = vfs.openFile('input');
  vfs.consume(file, 0, 3);
  vfs.consume(file, 65536, 1, true);
  vfs.readAhead(file, 131072, 16384);
  vfs.readAheadRequests++;
  // Sentinel execution evidence tests serialization, not the dispatcher (coverage.test.ts).
  const execution = { interp_insns: 12, interp_code_entries: 6, interp_functions: 2, interp_unowned_entries: 0 };
  const runtime = {
    vfs, manifest: { id: 'snapshot-probe', pipeline: { modules: [] } },
    host: { codeCoverage: new Map([[200, 2], [100, 3]]), codeCoverageDropped: 7, frameIndex: 9, metrics: (): unknown => execution,interpreterCoverage:()=>({capacity:1048576,dropped:0,entries:[{address:125,owner:100,count:6,instructions:12}]}) },
    rangeFiles: null, errors: [], sliceEvents: 0, firstFrameMs: null, frameTimes: [],
    diagnostics: () => ({ timing: {} }),
  };
  const snapshot = BGTRuntime.prototype.coverageSnapshot.call(runtime as unknown as BGTRuntime);
  expect(snapshot.interpreter).toEqual(runtime.host.interpreterCoverage());
  expect(snapshot.code).toEqual([{ address: 100, kind: 3 }, { address: 200, kind: 2 }]);
  expect(snapshot.files).toEqual([{ path: 'input', offset: 0, length: 65536 }, { path: 'input', offset: 65536, length: 65536 }]);
  expect(snapshot.readAhead).toEqual([{ path: 'input', offset: 131072, length: 65536 }]);
  expect(snapshot.metrics).toMatchObject({
    execution, code_entries_dropped: 7, frame: 9,
    crtConsumedBytes: 3, crtObservedBytes: 1, crtReadAheadBytes: 16384, crtReadAheadRequests: 1,
  });
  // A real buffered flush can add the final entries and overflow the independent host cap.
  runtime.host.metrics = () => {
    runtime.host.codeCoverage.set(300,1);runtime.host.codeCoverageDropped=8;
    return null;
  };
  const flushed=BGTRuntime.prototype.coverageSnapshot.call(runtime as unknown as BGTRuntime);
  expect(flushed.metrics.execution).toBeNull();expect(flushed.code).toContainEqual({address:300,kind:1});
  expect(flushed.metrics.code_entries_dropped).toBe(8);
});
