// Original CC0-1.0. Reviewer-approved exact expected-error contract for this fixture ONLY.
import { E_LIMIT, GPU_OP } from '../../bgt/runtime/abi';
import type { CommandError } from '../../bgt/runtime/commands';
import type { Headless } from './headless';

export const scalePixelFailures = ['late red pixel', 'retained late green pixel', 'mapped late blue pixel',
  'churn late blue pixel', 'churn late blue pixel', 'churn late blue pixel', 'post exhaustion blue pixel',
  'high feedback exact bytes', 'high feedback range sentinels', 'late UBO blue pixel'];

/** Zero errors everywhere else. Scale may reach its single deliberate byte-OOM, never exceed it. */
export function assertGlErrors(id: string, host: { commandErrorCount: number; commandErrors: CommandError[] }, complete = false): void {
  const scale = id.replace(/-interp$/, '') === 'x64-gl-scale';
  const { commandErrorCount: count, commandErrors: errors } = host;
  if (!scale) { if (count) throw new Error(JSON.stringify(errors)); return; }
  if (count !== errors.length || count > 1 || (complete && count !== 1) ||
      errors.some(e => e.code !== E_LIMIT || e.op !== GPU_OP.BUFFER_CREATE))
    throw new Error('x64-gl-scale expected exactly one BUFFER_CREATE E_LIMIT: ' + JSON.stringify(errors));
}

/** A recording backend never rasterizes/captures. All non-GPU checks must still pass. */
export function assertScaleRecording(h: Headless): void {
  assertGlErrors('x64-gl-scale', h.host, true);
  const failures = h.logs.filter(l => l.includes('x64-gl-scale FAIL ') && !l.includes('failures='))
    .map(l => l.replace(/^guest: /, '')).sort();
  const want = scalePixelFailures.map(s => 'x64-gl-scale FAIL ' + s).sort();
  const m = h.host.metrics() as Record<string, any>;
  if (JSON.stringify(failures) !== JSON.stringify(want) ||
      !h.logs.some(l => l.includes('x64-gl-scale FAIL failures=10')) ||
      h.logs.filter(l => l.includes('GL_OUT_OF_MEMORY object=buffers')).length !== 1 ||
      !h.logs.some(l => l.includes('x64-gl-scale ok byte exhaustion recovery')) ||
      m.gl_objects.buffers.peak !== 12002 || m.gl_objects.buffers.failures !== 1 || m.gl_objects.buffers.failed_requests !== 1 ||
      m.gl_objects.vaos.peak !== 12000 || m.gl_objects.vaos.failures !== 0 || m.gl_objects.vaos.failed_requests !== 0 ||
      m.gl_draws < 12007 || m.gl_unimplemented !== 0 || m.gl_stubs.length || m.stubs.length)
    throw new Error('x64-gl-scale recording contract failed: ' + JSON.stringify({ failures, logs: h.logs, metrics: m }));
}
