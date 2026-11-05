// Reuse discovery only while one test exercises immutable tool inputs. Never carry
// the result into another test: source/compiler/SDK changes must be rediscovered.
import { beforeEach } from 'vitest';

export function perTestTool(discover: () => string): () => string {
  let tool: string | undefined;
  beforeEach(() => { tool = undefined; });
  // Deliberately lazy: the first discovery still runs within the test's deadline.
  return () => tool ??= discover();
}
