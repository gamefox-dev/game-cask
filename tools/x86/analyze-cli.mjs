#!/usr/bin/env node
// Read-only PE analysis, metadata and shared-registry import coverage.
import { spawnSync } from 'node:child_process';
import { x86tool } from '../build/pipeline.mjs';
import { analyzePeMetadata } from './pe-metadata.mjs';
import { importsCoverage } from './imports-coverage.mjs';

try {
  const args = process.argv.slice(2);
  if (!args[0]) throw new Error('usage: analyze -- FILE [--metadata | --disasm [--func HEX]]');
  const mi = args.indexOf('--metadata');
  if (args.includes('--imports-coverage')) {
    process.stdout.write(JSON.stringify(importsCoverage(args[0]), null, 2) + '\n');
  } else if (mi >= 0) {
    process.stdout.write(JSON.stringify(analyzePeMetadata(args[0]), null, 2)+'\n');
  } else {
    const dis = args.indexOf('--disasm');
    if (dis >= 0) args.splice(dis,1);
    const r = spawnSync(x86tool(),[dis>=0?'disasm':'analyze',...args],{stdio:'inherit'});
    if (r.error) throw r.error;
    process.exitCode = r.status ?? 1;
  }
} catch (e) { console.error(`analyze: ${e.message}`); process.exitCode=1; }
