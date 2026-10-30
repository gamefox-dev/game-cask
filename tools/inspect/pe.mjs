// PE file metadata. Random-access reads, never map a raw overlay into the virtual image.
// No execution and no engine-dependent decisions. Works for PE32 and PE32+.
export function peMetadata(readAt, fileSize) {
  const read = (off, n) => {
    if (!Number.isSafeInteger(off) || off < 0 || off + n > fileSize) throw new Error(`PE range outside file: ${off}+${n}`);
    const b = readAt(off, n);
    if (b.length !== n) throw new Error('short PE read');
    return b;
  };
  const dos = read(0, 64), nt = dos.readUInt32LE(60);
  const coff = read(nt, 24);
  if (coff.toString('latin1', 0, 4) !== 'PE\0\0') throw new Error('not a PE image');
  const count = coff.readUInt16LE(6), optSize = coff.readUInt16LE(20);
  if (count > 96) throw new Error('PE has more than 96 sections');
  const opt = read(nt + 24, optSize), magic = opt.readUInt16LE(0);
  if (![0x10b, 0x20b].includes(magic)) throw new Error('unsupported PE optional header');
  const plus = magic === 0x20b, dd = plus ? 112 : 96;
  const dirs = opt.readUInt32LE(dd - 4);
  const directory = (i) => dirs > i && dd + 8 * i + 8 <= opt.length ? [opt.readUInt32LE(dd + 8 * i), opt.readUInt32LE(dd + 8 * i + 4)] : [0, 0];
  const sections = [];
  for (let i = 0; i < count; i++) {
    const s = read(nt + 24 + optSize + i * 40, 40);
    sections.push({ name: s.toString('latin1', 0, 8).replace(/\0+$/, ''), vsize: s.readUInt32LE(8), rva: s.readUInt32LE(12), rawSize: s.readUInt32LE(16), rawPtr: s.readUInt32LE(20) });
  }
  const off = (rva, n = 1) => {
    if (rva < opt.readUInt32LE(60) && rva + n <= fileSize) return rva;
    for (const s of sections) {
      const delta = rva - s.rva, span = s.vsize || s.rawSize;
      if (delta >= 0 && delta + n <= span && delta + n <= s.rawSize && s.rawPtr + delta + n <= fileSize) return s.rawPtr + delta;
    }
    throw new Error(`PE RVA 0x${rva.toString(16)} is not backed by file bytes`);
  };
  const imports = [], importErrors = [], facts = [];
  const [imp, impSize] = directory(1);
  if (imp) try {
    if (impSize < 20) throw new Error('import directory too short');
    let ended = false;
    for (let i = 0; i + 20 <= impSize && i < 20 * 4096; i += 20) {
      const d = read(off(imp + i, 20), 20);
      if (d.every((v) => v === 0)) { ended = true; break; }
      const nrva = d.readUInt32LE(12);
      let name = '';
      for (let k = 0; k < 256; k++) {
        const c = read(off(nrva + k), 1)[0];
        if (!c) break;
        if (c < 32 || c > 126) throw new Error('invalid import DLL name');
        name += String.fromCharCode(c);
      }
      if (!name || name.length === 256) throw new Error('empty or unterminated import DLL name');
      imports.push(name);
    }
    if (!ended) throw new Error('unterminated import directory');
  } catch (e) { importErrors.push(e.message); }
  // Container magic is an observation only. Nothing in the pipeline branches on these facts.
  for (const s of sections) if (s.rawSize >= 4 && s.rawPtr + 4 <= fileSize) {
    const magic = read(s.rawPtr, 4).toString('latin1');
    if (magic === 'PK\x03\x04' || magic === 'GDPC') facts.push({ kind: 'embedded-container', signature: magic === 'GDPC' ? '0x43504447' : 'ZIP', offset: s.rawPtr, section: s.name });
  }
  const MACH = { 0x14c: 'i386', 0x8664: 'x86-64', 0xaa64: 'arm64' };
  const SUB = { 1: 'native', 2: 'windows-gui', 3: 'windows-console', 9: 'windows-ce' };
  const timestamp = coff.readUInt32LE(8), subsystem = opt.readUInt16LE(68);
  return { machine: MACH[coff.readUInt16LE(4)] ?? `0x${coff.readUInt16LE(4).toString(16)}`, pe32plus: plus,
    subsystem: SUB[subsystem] ?? subsystem, dll: !!(coff.readUInt16LE(22) & 0x2000), timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    sections: sections.map((s) => s.name), sectionTable: sections, imports, importErrors, facts, clr: directory(14)[0] > 0,
    imageBase: `0x${(plus ? opt.readBigUInt64LE(24) : BigInt(opt.readUInt32LE(28))).toString(16)}`,
    entryRva: opt.readUInt32LE(16), imageBytes: opt.readUInt32LE(56), headerBytes: opt.readUInt32LE(60),
    directories: Array.from({ length: 16 }, (_, i) => directory(i)), rvaToOffset: off };
}
