#!/usr/bin/env node
// Read-only streaming analysis CLI. --metadata supports both PE32 and PE32+; execution remains i386.
import { spawnSync } from 'node:child_process';
import { x86tool } from '../build/pipeline.mjs';
import { analyzePeMetadata } from './pe-metadata.mjs';

try {
  const args = process.argv.slice(2);
  if (!args[0]) throw new Error('usage: analyze -- FILE [--metadata | --disasm [--func HEX]]');
  const mi = args.indexOf('--metadata');
  if (mi >= 0) {
    process.stdout.write(JSON.stringify(analyzePeMetadata(args[0]), null, 2)+'\n');
  } else {
    const dis = args.indexOf('--disasm');
    if (dis >= 0) args.splice(dis,1);
    const r = spawnSync(x86tool(),[dis>=0?'disasm':'analyze',...args],{stdio:'inherit'});
    if (r.error) throw r.error;
    process.exitCode = r.status ?? 1;
  }
} catch (e) { console.error(`analyze: ${e.message}`); process.exitCode=1; }
