// K73 (Q135): which GPU limits the guest sees. SPDX-License-Identifier: MIT
import { isGpuLimitsMode, type GpuLimitsMode } from './abi';

export interface GpuLimitsPolicy { mode: GpuLimitsMode; source: 'option' | 'url' | 'manifest' | 'default' }

/** Resolve `gpu.limits`: explicit option > `?gpulimits=portable|device` > manifest > default ('portable').
 * 'portable' reports the portable table (GPU_PORTABLE_LIMITS) on every backend; 'device' the device's own values.
 * Invalid values throw (the runtime reports an invalid URL value and ignores it; an invalid manifest/option fails init). */
export function resolveGpuLimits(option?: unknown, url?: string | null, manifest?: unknown): GpuLimitsPolicy {
  if (option !== undefined) {
    if (!isGpuLimitsMode(option)) throw new RangeError(`invalid gpuLimits option ${JSON.stringify(option)} (use "portable" or "device")`);
    return { mode: option, source: 'option' };
  }
  if (url !== null && url !== undefined && url !== '') {
    if (!isGpuLimitsMode(url)) throw new RangeError(`invalid ?gpulimits=${url} (use portable or device)`);
    return { mode: url, source: 'url' };
  }
  if (manifest !== undefined) {
    if (!isGpuLimitsMode(manifest)) throw new RangeError('manifest gpu.limits must be "portable" or "device"');
    return { mode: manifest, source: 'manifest' };
  }
  return { mode: 'portable', source: 'default' };
}
