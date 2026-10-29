#!/usr/bin/env node
// npm run analyze -- FILE [--base HEX] [--disasm [--func HEX]]   (read-only; prints JSON or a listing)
import { execFileSync } from 'node:child_process';
import { x86tool } from '../build/pipeline.mjs';

const args = process.argv.slice(2);
const dis = args.indexOf('--disasm');
if (dis >= 0) args.splice(dis, 1);
if (!args[0]) { console.error('usage: npm run analyze -- FILE [--base HEX] [--disasm [--func HEX]]'); process.exit(1); }
process.stdout.write(execFileSync(x86tool(), [dis >= 0 ? 'disasm' : 'analyze', ...args], { maxBuffer: 256 << 20 }));
