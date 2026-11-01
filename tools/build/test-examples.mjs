// Static test declarations are read without importing/executing test modules.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';

export function declaredExamples(file, root = ROOT) {
  const text = readFileSync(file, 'utf8');
  const matches = [...text.matchAll(/^\/\/ @bgt-examples: (.*)$/gm)];
  if (!matches.length) return []; // No prebuilt examples: standalone/owned-fixture tests.
  if (matches.length !== 1) throw new Error(`${file}: declare exactly one // @bgt-examples: <ids or none>`);
  const value = matches[0][1].trim();
  if (value === 'none') return [];
  const ids = value.split(/\s+/);
  for (const id of ids) if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !existsSync(join(root, 'examples', id, 'game.json'))) {
    throw new Error(`${file}: unknown kit example ${id}`);
  }
  return [...new Set(ids)].sort();
}
// The normal CI job and the required scale job partition the full default suite.
// Plain npm test has no exclusions. Never infer this policy from cache presence.
export function ciLight() { return process.env.BGT_CI_LIGHT === '1'; }
export function selectExampleDirs(dirs, { check = false, light = ciLight(), includeScale = process.env.BGT_INCLUDE_SCALE === '1' } = {}) {
  return dirs.filter((dir) => !dir.replace(/\\/g, '/').endsWith('/x64-scale') || (!light && (!check || includeScale)));
}
export function testExamples(files, root = ROOT) {
  return [...new Set(files.flatMap((file) => declaredExamples(resolve(file), root)))].sort().map((id) => `examples/${id}`);
}
