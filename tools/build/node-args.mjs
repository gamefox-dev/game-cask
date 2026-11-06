// Internal file transport; reconstruct JS argv only AFTER the OS process boundary.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const args = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.argv = [process.execPath, ...args];
await import(pathToFileURL(args[0]).href);
