// SPDX-License-Identifier: CC0-1.0
// K73 (Q135): `gpu.limits` resolution. Breakage caught: a URL/manifest typo silently reporting device limits, or the
// default changing away from the portable table (cross-backend guest divergence, MMX8 r30).
import { describe, expect, it } from 'vitest';
import { resolveGpuLimits } from '../../bgt/runtime/gpu-limits-policy';

describe('K73 gpu.limits policy', () => {
  it('defaults to portable', () => expect(resolveGpuLimits()).toEqual({ mode: 'portable', source: 'default' }));
  it('option > url > manifest', () => {
    expect(resolveGpuLimits('device', 'portable', 'portable')).toEqual({ mode: 'device', source: 'option' });
    expect(resolveGpuLimits(undefined, 'device', 'portable')).toEqual({ mode: 'device', source: 'url' });
    expect(resolveGpuLimits(undefined, null, 'device')).toEqual({ mode: 'device', source: 'manifest' });
    expect(resolveGpuLimits(undefined, '', 'device')).toEqual({ mode: 'device', source: 'manifest' });
  });
  it('rejects invalid values', () => {
    expect(() => resolveGpuLimits('max')).toThrow(/gpuLimits option/);
    expect(() => resolveGpuLimits(undefined, '1')).toThrow(/gpulimits=1/);
    expect(() => resolveGpuLimits(undefined, null, true)).toThrow(/manifest gpu.limits/);
  });
});
