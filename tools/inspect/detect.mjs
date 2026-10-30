// Deterministic, read-only file format detection. Pure functions over a
// Buffer; no execution of inputs, no decompression.

import { peMetadata } from './pe.mjs';

const u16 = (b, o) => (o + 2 <= b.length ? b.readUInt16LE(o) : -1);
const u32 = (b, o) => (o + 4 <= b.length ? b.readUInt32LE(o) : -1);
const ascii = (b, o, n) => (o + n <= b.length ? b.toString('latin1', o, o + n) : '');

export function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Uint32Array(256);
  for (const x of buf) counts[x]++;
  let h = 0;
  for (const c of counts) if (c) h -= (c / buf.length) * Math.log2(c / buf.length);
  return Math.round(h * 1000) / 1000;
}

export function printableRuns(buf, min = 6) {
  let runs = 0, cur = 0;
  for (const x of buf) {
    if (x >= 0x20 && x < 0x7f) cur++;
    else {
      if (cur >= min) runs++;
      cur = 0;
    }
  }
  return runs + (cur >= min ? 1 : 0);
}

export function strings(buf, min = 6, limit = 200) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const x = buf[i];
    const ok = i < buf.length && x >= 0x20 && x < 0x7f;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= min) out.push({ offset: start, text: buf.toString('latin1', start, i) });
      start = -1;
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** UTF-16LE strings (Latin text, at even and odd alignment), e.g. Win32 Unicode resources. Non-Latin scripts are
 *  not scanned for here (binary data reads as random CJK); `--strings` decodes resource text separately. */
export function utf16Strings(buf, min = 6, limit = 200) {
  const out = [];
  const ok = (c) => c === 9 || (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c < 0x250) || (c >= 0x2010 && c < 0x2070);
  for (const align of [0, 1]) {
    let start = -1, text = '';
    for (let i = align; i + 1 < buf.length + 2; i += 2) {
      const c = i + 1 < buf.length ? buf.readUInt16LE(i) : 0;
      // require mostly-ASCII content so binary data does not read as CJK text
      if (i + 1 < buf.length && ok(c) && (c < 0x7f || text.length > 0)) {
        if (start < 0) start = i;
        text += String.fromCharCode(c);
        continue;
      }
      if (start >= 0 && text.length >= min && /[A-Za-z]{2}/.test(text)) out.push({ offset: start, text });
      start = -1;
      text = '';
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => a.offset - b.offset).slice(0, limit);
}

/** Byte-pattern census for 16-bit x86 code. Heuristic: data bytes can match too. */
export function x86Census(buf) {
  const ints = {};
  let opsize = 0, addrsize = 0, portIo = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xcd) {
      const n = buf[i + 1];
      if ([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x1a, 0x20, 0x21, 0x2f, 0x33, 0x67].includes(n)) {
        const k = `int_${n.toString(16).padStart(2, '0')}h`;
        ints[k] = (ints[k] ?? 0) + 1;
      }
    }
    if (buf[i] === 0x66) opsize++;
    if (buf[i] === 0x67) addrsize++;
    if ([0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef].includes(buf[i])) portIo++;
  }
  return {
    interrupt_call_sites: ints,
    operand_size_prefix_66: opsize,
    address_size_prefix_67: addrsize,
    port_io_opcode_bytes: portIo,
    note: 'byte-pattern counts, not a disassembly; data regions can produce false matches',
  };
}

const INT_MEANING = {
  int_10h: 'BIOS video services (mode set, text output)',
  int_16h: 'BIOS keyboard',
  int_1ah: 'BIOS time/RTC',
  int_15h: 'BIOS system services (often joystick/wait)',
  int_21h: 'DOS services (file I/O, exit, memory)',
  int_33h: 'mouse driver',
  int_2fh: 'DOS multiplex (XMS/DPMI detection)',
  int_67h: 'EMS',
  int_13h: 'BIOS disk',
};

export function interpretCensus(c) {
  const hints = [];
  for (const [k, n] of Object.entries(c.interrupt_call_sites)) if (INT_MEANING[k]) hints.push(`${k} x${n}: ${INT_MEANING[k]}`);
  if (c.operand_size_prefix_66 > 50) hints.push(`many 0x66 operand-size prefixes (${c.operand_size_prefix_66}): likely 32-bit (386+) instructions in 16-bit code`);
  if (c.port_io_opcode_bytes > 10) hints.push(`port I/O opcode bytes x${c.port_io_opcode_bytes}: direct hardware access (VGA/PIT/speaker/PIC) plausible`);
  return hints;
}

function nintendoLogoAt(b, off) {
  // First bytes of the GBA/GB boot logo; used only as a format signature.
  const gba = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];
  const gb = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];
  const sig = off === 4 ? gba : gb;
  return sig.every((v, i) => b[off + i] === v);
}

/**
 * @param {Buffer} b file contents
 * @param {string} name file name (for extension hints)
 * @returns {{format: string, platform: string|null, confidence: 'high'|'medium'|'low', details: object, hints?: string[]}}
 */
export function detect(b, name, file = null) {
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const head = ascii(b, 0, 4);
  if (b.length === 0) return { format: 'empty', platform: null, confidence: 'high', details: {} };

  if (head.startsWith('MZ') || head.startsWith('ZM')) {
    const lfanew = u32(b, 0x3c);
    if (lfanew > 0 && lfanew < b.length - 4) {
      const sig = ascii(b, lfanew, 4);
      if (sig === 'PE\0\0') {
        try {
          const details = peMetadata(file?.readAt ?? ((o, n) => b.subarray(o, o + n)), file?.size ?? b.length);
          return { format: details.clr ? 'pe-dotnet' : 'pe', platform: 'windows', details, confidence: 'high' };
        } catch (e) {
          return { format: 'pe', platform: 'windows', details: { parseError: e.message }, confidence: 'low' };
        }
      }
      if (sig.startsWith('NE')) return { format: 'ne', platform: 'windows-16bit', confidence: 'high', details: { note: 'Win16/OS2 New Executable' } };
      if (sig.startsWith('LE') || sig.startsWith('LX')) {
        return { format: sig.slice(0, 2).toLowerCase(), platform: 'dos-extended', confidence: 'high', details: { note: 'linear executable (DOS extender, e.g. DOS/4GW)' } };
      }
    }
    const pages = u16(b, 4), last = u16(b, 2), hdrParas = u16(b, 8), relocs = u16(b, 6);
    const loadSize = (pages - (last ? 1 : 0)) * 512 + last - hdrParas * 16;
    const text = b.toString('latin1');
    const ext16 = ['DOS/4G', 'PMODE', 'CWSDPMI', 'DOS32A', 'Phar Lap'].filter((s) => text.includes(s));
    const code = b.subarray(hdrParas * 16);
    const census = x86Census(code);
    return {
      format: 'mz',
      platform: ext16.length ? 'dos-extended' : 'dos',
      confidence: 'high',
      details: { headerBytes: hdrParas * 16, relocations: relocs, loadImageBytes: loadSize, entryCS: u16(b, 0x16), entryIP: u16(b, 0x14), extenderStrings: ext16, x86: census },
      hints: interpretCensus(census),
    };
  }
  if (b[0] === 0x7f && head.slice(1) === 'ELF') {
    const MACH = { 3: 'i386', 0x3e: 'x86-64', 0x28: 'arm', 0xb7: 'arm64', 8: 'mips', 0x14: 'ppc' };
    return { format: 'elf', platform: 'unix', confidence: 'high', details: { class: b[4] === 2 ? 64 : 32, type: u16(b, 16), machine: MACH[u16(b, 18)] ?? u16(b, 18) } };
  }
  const m32 = u32(b, 0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(m32)) return { format: 'mach-o', platform: 'macos', confidence: 'high', details: {} };
  if (m32 === 0xbebafeca && u32(b, 4) >>> 0 < 30) return { format: 'mach-o-fat', platform: 'macos', confidence: 'medium', details: {} };
  if (head === '\0asm') return { format: 'wasm', platform: 'web', confidence: 'high', details: { version: u32(b, 4) } };
  if (head === 'PK\x03\x04' || head === 'PK\x05\x06') return { format: 'zip', platform: null, confidence: 'high', details: { note: 'archive; extract into a separate untrusted directory before analysis' } };
  if (head === 'Rar!') return { format: 'rar', platform: null, confidence: 'high', details: {} };
  if (ascii(b, 0, 6) === '7z\xbc\xaf\x27\x1c') return { format: '7z', platform: null, confidence: 'high', details: {} };
  if (b[0] === 0x1f && b[1] === 0x8b) return { format: 'gzip', platform: null, confidence: 'high', details: {} };
  if (head === 'MSCF') return { format: 'cab', platform: 'windows', confidence: 'high', details: {} };
  if (ascii(b, 0x8001, 5) === 'CD001') return { format: 'iso9660', platform: null, confidence: 'high', details: { volume: ascii(b, 0x8028, 32).trim() } };
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return { format: 'png', platform: null, confidence: 'high', details: { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } };
  if (head.startsWith('GIF8')) return { format: 'gif', platform: null, confidence: 'high', details: { width: u16(b, 6), height: u16(b, 8) } };
  if (head.startsWith('BM') && u32(b, 2) === b.length) return { format: 'bmp', platform: null, confidence: 'high', details: { width: u32(b, 18), height: u32(b, 22), bpp: u16(b, 28) } };
  if (b[0] === 0xff && b[1] === 0xd8) return { format: 'jpeg', platform: null, confidence: 'high', details: {} };
  if (b[0] === 0x0a && [0, 2, 3, 4, 5].includes(b[1]) && b[2] === 1 && ext === 'pcx') {
    return { format: 'pcx', platform: 'dos', confidence: 'high', details: { width: u16(b, 8) - u16(b, 4) + 1, height: u16(b, 10) - u16(b, 6) + 1, bpp: b[3] } };
  }
  if (head === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { format: 'wav', platform: null, confidence: 'high', details: { channels: u16(b, 22), rate: u32(b, 24), bits: u16(b, 34) } };
  if (ascii(b, 0, 19) === 'Creative Voice File') return { format: 'voc', platform: 'dos', confidence: 'high', details: {} };
  if (head === 'MThd') return { format: 'midi', platform: null, confidence: 'high', details: { tracks: b.readUInt16BE(10) } };
  if (head === 'OggS') return { format: 'ogg', platform: null, confidence: 'high', details: {} };
  if (head.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ext === 'mp3')) return { format: 'mp3', platform: null, confidence: 'medium', details: {} };
  if (['M.K.', 'M!K!', 'FLT4', '4CHN', '6CHN', '8CHN'].includes(ascii(b, 1080, 4))) return { format: 'mod', platform: null, confidence: 'high', details: { title: ascii(b, 0, 20).replace(/\0.*$/, '') } };
  if (head === 'NES\x1a') return { format: 'ines', platform: 'nes', confidence: 'high', details: { prg16k: b[4], chr8k: b[5], mapper: (b[6] >> 4) | (b[7] & 0xf0) } };
  if (b.length >= 0xc0 && nintendoLogoAt(b, 4)) return { format: 'gba-rom', platform: 'gba', confidence: 'high', details: { title: ascii(b, 0xa0, 12).replace(/\0+$/, ''), code: ascii(b, 0xac, 4) } };
  if (b.length >= 0x150 && nintendoLogoAt(b, 0x104)) return { format: 'gb-rom', platform: 'gameboy', confidence: 'high', details: { title: ascii(b, 0x134, 15).replace(/\0+$/, ''), cgb: b[0x143] } };
  if (ascii(b, 0x100, 4) === 'SEGA') return { format: 'md-rom', platform: 'genesis', confidence: 'medium', details: {} };
  for (const base of [0x7fc0, 0xffc0, 0x81c0, 0x101c0]) {
    if (b.length > base + 0x20) {
      const chk = u16(b, base + 0x1e), cpl = u16(b, base + 0x1c);
      if (((chk ^ cpl) & 0xffff) === 0xffff && chk !== 0) {
        return { format: 'snes-rom', platform: 'snes', confidence: 'medium', details: { headerAt: base, title: ascii(b, base, 21).trim(), copierHeader: (base & 0x200) !== 0 } };
      }
    }
  }
  if (ext === 'com' && b.length <= 0xff00) {
    const census = x86Census(b);
    const ints = Object.values(census.interrupt_call_sites).reduce((a, n) => a + n, 0);
    const firstOp = b[0];
    const plausibleStart = [0xe9, 0xeb, 0xe8, 0xb4, 0xb8, 0xfa, 0xfc, 0x8c, 0x0e, 0x66, 0x31, 0x33, 0xbe, 0xbf, 0xba, 0xb9, 0xbb, 0x55, 0x1e].includes(firstOp);
    return {
      format: 'dos-com',
      platform: 'dos',
      confidence: ints > 0 && plausibleStart ? 'medium' : 'low',
      details: { loadAddress: '0x0100 (CS=DS=ES=SS=PSP segment)', maxSize: 65280, firstOpcode: `0x${firstOp.toString(16)}`, x86: census },
      hints: [
        '.COM has no header: flat 16-bit real-mode image loaded at offset 0x100; execution starts at the first byte',
        ...interpretCensus(census),
      ],
    };
  }
  const sample = b.subarray(0, 4096);
  let printable = 0;
  for (const x of sample) if ((x >= 0x20 && x < 0x7f) || x === 9 || x === 10 || x === 13) printable++;
  if (printable / sample.length > 0.95) {
    const SRC = ['c', 'h', 'cpp', 'hpp', 'pas', 'asm', 's', 'bas', 'inc', 'js', 'py', 'lua'];
    return { format: SRC.includes(ext) ? 'source-text' : 'text', platform: null, confidence: 'medium', details: { ext } };
  }
  return { format: 'data', platform: null, confidence: 'low', details: { ext, note: 'unrecognized binary; check entropy for compression/encryption' } };
}
