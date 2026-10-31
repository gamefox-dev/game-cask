import { test } from './fixtures';
import { injectBrokenWebGPU } from './broken-webgpu';
import { assertWebGPUAvailable } from './webgpu-availability';

// These deliberately skip with a probe reason, or fail under BGT_REQUIRE_WEBGPU=1.
// No healthy-hardware test is disabled or mocked by this isolated fixture.
for (const mode of ['device', 'submission', 'lost'] as const)
  test(`WebGPU-only availability policy: injected broken ${mode}`, async ({ page }, info) => {
    test.skip(process.env.BGT_TEST_BROKEN_WEBGPU !== '1', 'opt-in policy check: BGT_TEST_BROKEN_WEBGPU=1 (required mode must fail)');
    await injectBrokenWebGPU(page, mode);
    await assertWebGPUAvailable(page, info);
    throw new Error('broken WebGPU must never pass preflight');
  });
