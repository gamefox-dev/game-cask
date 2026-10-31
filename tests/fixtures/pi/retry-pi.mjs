#!/usr/bin/env node
// No model: a resumable session followed by configurable per-attempt provider failures.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const dir = args[args.indexOf('--session-dir') + 1];
const count = dir.match(/\.attempt-(\d+)\.d/)?.[1] ?? '1';
const attempt = Number(count);
let prompt = '';
for await (const b of process.stdin) prompt += b;
if (attempt > 1) {
  assert(args.includes('--fork'));
  assert.match(readFileSync(args[args.indexOf('--fork') + 1], 'utf8'), /SESSION_FACT/);
  assert.match(prompt, /Continue the same task/);
} else assert(!args.includes('--fork'));
const session = [{ type: 'session', id: `s${count}`, cwd: process.cwd() },
  { type: 'message', id: `m${count}`, parentId: null, message: { role: 'assistant',
    stopReason: 'stop', content: [{ type: 'text', text: `SESSION_FACT attempt=${count}` }] } }];
writeFileSync(join(dir, 'fixture.jsonl'), session.map(s => JSON.stringify(s)).join('\n') + '\n');
if (process.env.FAKE_TRACE) appendFileSync(process.env.FAKE_TRACE, JSON.stringify({ attempt, args, runId: process.env.PI_BRIDGE_RUN_ID }) + '\n');
if (process.env.FAKE_EARLY_ERROR) console.error(process.env.FAKE_EARLY_ERROR);
if (process.env.FAKE_DELAY) await new Promise(r => setTimeout(r, Number(process.env.FAKE_DELAY)));
if (attempt <= Number(process.env.FAKE_FAILURES ?? 1)) {
  console.error(attempt === 1 ? (process.env.FAKE_ERROR ?? 'HTTP 503 temporarily unavailable') :
    (process.env.FAKE_NEXT_ERROR ?? 'HTTP 503 temporarily unavailable'));
  process.exit(Number(process.env.FAKE_EXIT ?? 17));
}
console.log(`SESSION_FACT attempt=${count}`);
