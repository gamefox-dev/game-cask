#!/usr/bin/env node
// Kit-maintainer tool (needs network): regenerate the Godot entries of tools/engine/runtimes.json from the
// OFFICIAL release host (github.com/godotengine/godot-builds) and the official source tags (godotengine/godot).
//
//   GITHUB_TOKEN=... node tools/engine/godot-releases.mjs [--write]
//
// Per stable release in scope it pins: the export-template archive URL and size, the published SHA-512 from the
// release's SHA512-SUMS.txt (null when that release publishes none), the web-template members' names, sizes and
// CRC32 read from the archive's central directory (HTTP range reads, nothing else is downloaded), the release
// commit (exact build id) and the SHA-256 of LICENSE.txt/COPYRIGHT.txt at the tag. Member SHA-256 and runtime
// file hashes are only ever pinned from a full archive verified against the published SHA-512 (engine:fetch
// --full prints them); existing pins are preserved.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { httpSource, listEntries } from './zip.mjs';

export const SCOPE = /^(3\.[2-6]|4\.[0-4])(\.\d+)?-stable$/;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const token = process.env.GITHUB_TOKEN;
async function json(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
  return r.json();
}
async function bytes(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
/** Which web templates a release ships, by member name (not by assumption). */
export function variantsFromMembers(version, names) {
  const major = Number(version.split('.')[0]), out = [];
  const has = n => names.includes('templates/' + n);
  if (major === 3) {
    if (has('webassembly_release.zip')) out.push({ variant: 'nothreads', member: 'templates/webassembly_release.zip', threads: false });
    if (has('webassembly_threads_release.zip')) out.push({ variant: 'threads', member: 'templates/webassembly_threads_release.zip', threads: true });
  } else {
    if (has('web_nothreads_release.zip')) out.push({ variant: 'nothreads', member: 'templates/web_nothreads_release.zip', threads: false });
    // Godot 4.0-4.2 ship only the threaded build under this name; 4.3+ ship both.
    if (has('web_release.zip')) out.push({ variant: 'threads', member: 'templates/web_release.zip', threads: true });
  }
  return out;
}
export const shellFlavor = version => /^3\.2(\.|$)/.test(version) ? 'godot-legacy' : 'godot-config';

async function main() {
  const manifestUrl = new URL('runtimes.json', import.meta.url), old = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const previous = new Map(old.runtimes.map(r => [r.id, r]));
  // One-time v1 migration: the K45 entry pinned the member ZIP SHA-256 and its files under the bare version id.
  for (const r of old.runtimes) if (!r.member && r.sha256) previous.set(`${r.id}-nothreads`, { ...r, aliases: [r.id], member: { sha256: r.sha256, migrated: true } });
  const releases = [];
  for (let page = 1; page < 10; page++) {
    const list = await json(`https://api.github.com/repos/godotengine/godot-builds/releases?per_page=100&page=${page}`);
    releases.push(...list); if (list.length < 100) break;
  }
  const runtimes = [];
  for (const rel of releases.filter(r => SCOPE.test(r.tag_name)).sort((a, b) => a.tag_name.localeCompare(b.tag_name, 'en', { numeric: true }))) {
    const tag = rel.tag_name, version = tag.replace(/-stable$/, '');
    const tpz = rel.assets.find(a => a.name === `Godot_v${version}-stable_export_templates.tpz`);
    if (!tpz) { console.error('skip (no templates): ' + tag); continue; }
    const sumsAsset = rel.assets.find(a => a.name === 'SHA512-SUMS.txt');
    let sha512 = null;
    if (sumsAsset) {
      const line = (await bytes(sumsAsset.browser_download_url)).toString('utf8').split('\n').find(l => l.trim().endsWith(' ' + tpz.name));
      sha512 = line?.trim().split(/\s+/)[0] ?? null;
      if (sha512 && !/^[a-f0-9]{128}$/.test(sha512)) throw new Error('bad SHA512 line for ' + tag);
    }
    const entries = await listEntries(await httpSource(tpz.browser_download_url, { expectedSize: tpz.size }));
    const commit = (await json(`https://api.github.com/repos/godotengine/godot/commits/${tag}`)).sha;
    const notices = [];
    for (const file of ['LICENSE.txt', 'COPYRIGHT.txt']) notices.push({ file, sha256: sha256(await bytes(`https://raw.githubusercontent.com/godotengine/godot/${tag}/${file}`)), url: `https://raw.githubusercontent.com/godotengine/godot/${tag}/${file}` });
    const major = Number(version[0]);
    for (const v of variantsFromMembers(version, entries.map(e => e.name))) {
      const e = entries.find(x => x.name === v.member), id = `godot-${version}-${v.variant}`, prior = previous.get(id);
      const pinned = prior?.member?.sha256 && (prior.member.migrated || (prior.member.crc32 === e.crc32 && prior.member.size === e.size)) ? prior : null;
      runtimes.push({
        id, ...(prior?.aliases ? { aliases: prior.aliases } : {}), adapter: major === 3 ? 'godot3' : 'godot4', engine: 'godot', version, status: 'stable.official', build: commit,
        variant: v.variant, officialSource: rel.html_url,
        archive: { url: tpz.browser_download_url, size: tpz.size, sha512, sha512Source: sha512 ? sumsAsset.browser_download_url : null },
        member: { name: v.member, size: e.size, compressedSize: e.compressedSize, crc32: e.crc32, sha256: pinned?.member.sha256 ?? null, ...(pinned?.member.pinnedFrom ? { pinnedFrom: pinned.member.pinnedFrom } : {}) },
        ...(pinned?.files ? { files: pinned.files, fileHashes: pinned.fileHashes } : {}),
        entry: 'godot.js', shell: shellFlavor(version), license: 'MIT (engine); bundled third-party licenses apply (COPYRIGHT.txt)',
        requirements: { renderer: 'webgl2', threads: v.threads, isolation: v.threads }, notices,
      });
    }
    console.error(tag + ': ' + runtimes.filter(r => r.version === version).map(r => r.variant).join(', ') + (sha512 ? ' (SHA-512 published)' : ' (no published checksum)'));
  }
  const out = { ...old, schema: 'game-cask/engine-runtimes/2', generatedBy: 'tools/engine/godot-releases.mjs', runtimes };
  if (process.argv.includes('--write')) writeFileSync(manifestUrl, JSON.stringify(out, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('godot-releases: ' + e.message); process.exitCode = 1; });
