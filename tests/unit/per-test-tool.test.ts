// @bgt-examples: none
// Real native CC0 tool, not a mocked discovery counter: changes to the tool and
// its SDK header must produce and execute fresh artifacts in successive tests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { perTestTool } from '../support/per-test-tool';
// @ts-expect-error plain ESM
import { prepareObjects } from '../../tools/build/objects.mjs';

describe('per-test tool discovery lifetime', () => {
  let root: string, version: string, previous: string | undefined;
  let discoveries = 0;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bgt-test-tool-'));
    mkdirSync(join(root, 'sdk'));
    version = execFileSync('cc', ['--version'], { encoding: 'utf8' });
  });
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });
  const tool = perTestTool(() => {
    discoveries++;
    const [object] = prepareObjects({
      sources: [join(root, 'tool.c')], flags: ['-O0', '-I', join(root, 'sdk')],
      includes: [], compiler: { path: 'cc', prefix: [], version },
      cache: join(root, 'objects'), root,
    });
    execFileSync('cc', [...object.args.slice(1), '-o', object.out]);
    const executable = object.out + '.tool';
    execFileSync('cc', [object.out, '-o', executable]);
    return executable;
  });
  it.each([
    { change: 'initial inputs', source: 10, sdk: 1, answer: 11 },
    { change: 'changed tool source', source: 20, sdk: 1, answer: 21 },
    { change: 'changed SDK header', source: 20, sdk: 3, answer: 23 },
  ])('rediscovers $change, but only once within the deadline', ({ source, sdk, answer }) => {
    writeFileSync(join(root, 'tool.c'), `#include <sdk.h>
int main(void){return ${source}+SDK_VALUE;}
`);
    writeFileSync(join(root, 'sdk/sdk.h'), `#define SDK_VALUE ${sdk}
`);
    const before = discoveries;
    const path = tool();
    expect(discoveries).toBe(before + 1);
    expect(tool()).toBe(path);
    expect(discoveries).toBe(before + 1);
    expect(path).not.toBe(previous);
    const result = spawnSync(path);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(answer);
    previous = path;
  });
});
