#!/usr/bin/env node
// Original no-model fixture. Fails if the bridge ever enables tools or resumes the original session in place.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--fork')) {
  assert(args.includes('--no-tools'));
  assert(args.includes('--no-extensions'));
  assert(!args.includes('--session'));
  const snapshot = args[args.indexOf('--fork') + 1];
  assert.match(readFileSync(snapshot, 'utf8'), /ORCHID_742/);
  process.stdout.write('ORCHID_742\n');
} else {
  const dir = args[args.indexOf('--session-dir') + 1];
  const extension = args[args.indexOf('-e') + 1];
  if (process.env.PI_BRIDGE === '1') assert(extension.endsWith('/bridge/extension.js'));
  const records = [{ type: 'session', id: 'test', cwd: process.cwd() },
    { type: 'message', id: 'done', parentId: null, message: { role: 'assistant',
      stopReason: 'stop', content: [{ type: 'text', text: 'fixture finished' }] } }];
  writeFileSync(join(dir, 'fixture.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  process.stdout.write('fixture finished\n');
}
