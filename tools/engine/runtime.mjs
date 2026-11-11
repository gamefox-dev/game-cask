import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PRIVATE = join(ENGINE_ROOT, '.engine-private');
export const STORE = join(PRIVATE, 'runtimes');
export const hash = b => createHash('sha256').update(b).digest('hex');
export const manifest = JSON.parse(readFileSync(new URL('runtimes.json', import.meta.url)));
export function runtimeById(id) {
  const r = manifest.runtimes.find(r => r.id === id);
  if (!r) throw new Error('runtime not allowlisted: ' + id);
  if (!r.notices?.length || r.notices.some(n => !/^[a-f0-9]{64}$/.test(n.sha256))) throw new Error('runtime requires hash-pinned notices');
  return r;
}
export function provision(id, archive, { store = STORE, notices = dirname(resolve(archive)) } = {}) {
  const runtime = runtimeById(id);
  const zip = readFileSync(archive);
  if (hash(zip) !== runtime.sha256) throw new Error('runtime archive SHA-256 mismatch');
  const noticeBytes = runtime.notices.map(n => {
    const b = readFileSync(join(notices, n.file));
    if (hash(b) !== n.sha256) throw new Error('notice SHA-256 mismatch: ' + n.file);
    return b;
  });
  const target = join(resolve(store), id);
  if (existsSync(target)) { verifyRuntime(id, { store }); return target; }
  mkdirSync(resolve(store), { recursive: true });
  const staging = mkdtempSync(join(resolve(store), '.provision-'));
  try {
    const output = join(staging, id);
    execFileSync('python3', ['-I', fileURLToPath(new URL('offline-zip.py', import.meta.url)), resolve(archive), output, JSON.stringify(runtime.files)], { stdio: 'pipe' });
    runtime.notices.forEach((n, i) => writeFileSync(join(output, n.file), noticeBytes[i], { flag: 'wx' }));
    for (const name of runtime.files) if (hash(readFileSync(join(output, name))) !== runtime.fileHashes[name]) throw new Error('runtime member hash mismatch: ' + name);
    const files = { ...runtime.fileHashes, ...Object.fromEntries(runtime.notices.map(n => [n.file, n.sha256])) };
    writeFileSync(join(output, 'provision.json'), JSON.stringify({ schema: 'game-cask/engine-provision/1', runtime: id, archiveSha256: runtime.sha256, files }, null, 2) + '\n', { flag: 'wx' });
    renameSync(output, target);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return target;
}
export function verifyRuntime(id, { store = STORE } = {}) {
  const runtime = runtimeById(id), target = join(resolve(store), id);
  if (!existsSync(join(target, 'provision.json'))) throw new Error('runtime not provisioned: ' + id + ' (use npm run engine:provision -- ' + id + ' <local.zip>)');
  if (lstatSync(target).isSymbolicLink()) throw new Error('symlink runtime directory');
  const receipt = JSON.parse(readFileSync(join(target, 'provision.json')));
  if (receipt.runtime !== id || receipt.archiveSha256 !== runtime.sha256) throw new Error('runtime provision receipt mismatch');
  for (const [name, expected] of Object.entries({ ...runtime.fileHashes, ...Object.fromEntries(runtime.notices.map(n => [n.file, n.sha256])) })) {
    const file = join(target, name), st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || hash(readFileSync(file)) !== expected || receipt.files[name] !== expected) throw new Error('provisioned runtime hash mismatch: ' + name);
  }
  return { runtime, target, receipt };
}
