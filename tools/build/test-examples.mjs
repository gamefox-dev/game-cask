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
export function testExamples(files, root = ROOT) {
  return [...new Set(files.flatMap((file) => declaredExamples(resolve(file), root)))].sort().map((id) => `examples/${id}`);
}
