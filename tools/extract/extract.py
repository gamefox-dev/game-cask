#!/usr/bin/env python3
"""Static extractor for game distributions (never executes anything).

    python3 -I tools/extract/extract.py INPUT OUTDIR      -> OUTDIR/<files> + OUTDIR/extract.json

Handles, recursively:
  - ZIP archives (zip-slip safe)
  - PE images that embed other PE images in RT_RCDATA resources (installer wrappers/bundlers)
  - Inno Setup 5.x installers ("Inno Setup Setup Data (5.x.y)"): setup-0 blocks (CRC'd 4 KiB chunks,
    LZMA1), file location entries, setup-1 LZMA1 solid chunks, the 5.2+ CALL/JMP filter; every file
    is verified against the SHA-1 stored in the installer. Encrypted installers are refused.
Extracted executables are named from their own metadata (export-directory name for DLLs,
VERSIONINFO OriginalFilename for EXEs), otherwise fileNNN.bin. Generalised from the first Solitaire
trial's extractor. Standard library only.
"""
import hashlib
import io
import json
import lzma
import os
import struct
import sys
import zipfile
import zlib


# ---------------------------------------------------------------- PE helpers
class PE:
    def __init__(self, data):
        self.d = data
        e = struct.unpack_from("<I", data, 0x3C)[0]
        if data[e:e + 4] != b"PE\0\0":
            raise ValueError("not PE")
        self.nsec, = struct.unpack_from("<H", data, e + 6)
        optsz, = struct.unpack_from("<H", data, e + 20)
        self.chars, = struct.unpack_from("<H", data, e + 22)
        self.opt = e + 24
        magic, = struct.unpack_from("<H", data, self.opt)
        dd = self.opt + (96 if magic == 0x10B else 112)
        self.dirs = [struct.unpack_from("<II", data, dd + 8 * i) for i in range(16)]
        self.secs = []
        for i in range(self.nsec):
            s = self.opt + optsz + 40 * i
            vsize, va, rawsz, rawptr = struct.unpack_from("<IIII", data, s + 8)
            self.secs.append((va, max(vsize, rawsz), rawptr, rawsz))

    def off(self, rva):
        for va, sz, raw, rawsz in self.secs:
            if va <= rva < va + sz and rva - va < rawsz:
                return rva - va + raw
        raise ValueError("rva %x not in file" % rva)

    def resources(self):
        """yield (type, name, bytes) for every resource (first language)."""
        rva = self.dirs[2][0]
        if not rva:
            return
        base = self.off(rva)
        d = self.d

        def entries(o):
            nn, ni = struct.unpack_from("<HH", d, base + o + 12)
            for k in range(nn + ni):
                yield struct.unpack_from("<II", d, base + o + 16 + 8 * k)

        for t, tt in entries(0):
            if not tt & 0x80000000:
                continue
            for n, nt in entries(tt & 0x7FFFFFFF):
                if not nt & 0x80000000:
                    continue
                for _, leaf in entries(nt & 0x7FFFFFFF):
                    if leaf & 0x80000000:
                        continue
                    r, size = struct.unpack_from("<II", d, base + leaf)
                    try:
                        o = self.off(r)
                    except ValueError:
                        continue
                    yield t, n, d[o:o + size]
                    break

    def export_name(self):
        rva = self.dirs[0][0]
        if not rva:
            return None
        try:
            o = self.off(rva)
            name_rva, = struct.unpack_from("<I", self.d, o + 12)
            no = self.off(name_rva)
            return self.d[no:self.d.index(b"\0", no)].decode("ascii", "replace")
        except ValueError:
            return None

    def original_filename(self):
        for t, _, data in self.resources():
            if t == 16:  # RT_VERSION
                key = "OriginalFilename".encode("utf-16-le")
                i = data.find(key)
                if i < 0:
                    return None
                j = i + len(key)
                while j + 2 <= len(data) and data[j:j + 2] == b"\0\0":
                    j += 2
                end = j
                while end + 2 <= len(data) and data[end:end + 2] != b"\0\0":
                    end += 2
                return data[j:end].decode("utf-16-le", "replace").strip() or None
        return None


def is_pe(b):
    if len(b) < 0x40 or b[:2] != b"MZ":
        return False
    e = struct.unpack_from("<I", b, 0x3C)[0]
    return e + 4 <= len(b) and b[e:e + 4] == b"PE\0\0"


# ---------------------------------------------------------------- Inno Setup 5.x
def lzma1(raw):
    p = raw[0]
    lc, p = p % 9, p // 9
    lp, pb = p % 5, p // 5
    dict_size, = struct.unpack_from("<I", raw, 1)
    dec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1, "dict_size": dict_size, "lc": lc, "lp": lp, "pb": pb}])
    return dec.decompress(raw[5:])


def inno_block(d, p):
    crc, stored, comp = struct.unpack_from("<IIB", d, p)
    if zlib.crc32(d[p + 4:p + 9]) != crc:
        raise ValueError("Inno block header CRC mismatch")
    p += 9
    raw = bytearray()
    remain = stored
    while remain > 0:
        c, = struct.unpack_from("<I", d, p)
        n = min(4096, remain - 4)
        chunk = d[p + 4:p + 4 + n]
        if zlib.crc32(chunk) != c:
            raise ValueError("Inno chunk CRC mismatch")
        raw += chunk
        p += 4 + n
        remain -= 4 + n
    return (lzma1(bytes(raw)) if comp else bytes(raw)), p


def unfilter_calls(buf):
    """Inverse of the Inno Setup 5.2.0+ x86 CALL/JMP address transform (64 KiB blocks)."""
    b = bytearray(buf)
    for bs in range(0, len(b), 0x10000):
        size = min(0x10000, len(b) - bs)
        i = 0
        while i < size - 4:
            if b[bs + i] in (0xE8, 0xE9):
                i += 1
                if b[bs + i + 3] in (0x00, 0xFF):
                    addr = (bs + i + 4) & 0xFFFFFF
                    rel = b[bs + i] | (b[bs + i + 1] << 8) | (b[bs + i + 2] << 16)
                    rel = (rel - addr) & 0xFFFFFFFF
                    if rel & 0x800000:
                        b[bs + i + 3] ^= 0xFF
                    b[bs + i:bs + i + 3] = bytes((rel & 0xFF, (rel >> 8) & 0xFF, (rel >> 16) & 0xFF))
                i += 4
            else:
                i += 1
    return bytes(b)


def inno_files(pe_bytes):
    pe = PE(pe_bytes)
    table = None
    for t, n, data in pe.resources():
        if t == 10 and n == 11111 and data[:6] == b"rDlPtS":
            table = data
    if table is None:
        return None
    rev, _total, _eo, _es, _ec, off0, off1, table_crc = struct.unpack_from("<8I", table, 12)
    if rev != 1 or zlib.crc32(table[:40]) != table_crc:
        raise ValueError("unsupported Inno SetupLdr table")
    sig = pe_bytes[off0:off0 + 64].split(b"\0")[0].decode("latin1")
    if not sig.startswith("Inno Setup Setup Data (5."):
        raise ValueError("unsupported Inno Setup version: %r (kit gap: only 5.x is implemented)" % sig)
    _hdr, p = inno_block(pe_bytes, off0 + 64)
    locs, _ = inno_block(pe_bytes, p)
    ENTRY = 74  # Inno 5.x location entry: slices, offsets, sizes, SHA-1 @0x24, timestamp, version, flags @0x48
    if len(locs) % ENTRY:
        raise ValueError("unexpected Inno file-location layout (kit gap)")
    chunks, out = {}, []
    for k in range(len(locs) // ENTRY):
        e = locs[ENTRY * k:ENTRY * (k + 1)]
        _first, _last, start, sub, size, csize = struct.unpack_from("<IIIqqq", e, 0)
        sha1 = e[0x24:0x38]
        flags, = struct.unpack_from("<H", e, 0x48)
        if flags & 0x40:
            raise ValueError("encrypted Inno Setup chunk: refusing (needs a password; no circumvention)")
        if start not in chunks:
            q = off1 + start
            if pe_bytes[q:q + 4] != b"zlb\x1a":
                raise ValueError("unsupported Inno compression (kit gap: LZMA1 only)")
            chunks[start] = lzma1(pe_bytes[q + 4:q + 4 + csize])
        data = chunks[start][sub:sub + size]
        if flags & 0x10:
            data = unfilter_calls(data)
        if hashlib.sha1(data).digest() != sha1:
            raise ValueError("SHA-1 mismatch for Inno entry %d" % k)
        out.append(("inno:%d" % k, data))
    return out


# ---------------------------------------------------------------- driver
def name_for(data, fallback):
    if is_pe(data):
        try:
            pe = PE(data)
            n = pe.export_name() if pe.chars & 0x2000 else pe.original_filename()
            n = n or pe.original_filename() or pe.export_name()
            if n:
                return os.path.basename(n.replace("\\", "/"))
        except (ValueError, struct.error):
            pass
    return fallback


def walk(data, chain, results, depth=0):
    """Expand containers; leaves are recorded."""
    if depth > 6:
        return
    if data[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                walk(z.read(info), chain + ["zip:" + info.filename], results, depth + 1)
        return
    if is_pe(data):
        try:
            files = inno_files(data)
        except ValueError as e:
            results.append({"chain": chain, "data": data, "note": str(e)})
            return
        if files is not None:
            for tag, payload in files:
                walk(payload, chain + [tag], results, depth + 1)
            return
        embedded = []
        try:
            for t, n, res in PE(data).resources():
                if t == 10 and is_pe(res):
                    embedded.append((n, res))
        except (ValueError, struct.error):
            pass
        for n, res in embedded:
            walk(res, chain + ["rcdata:%s" % n], results, depth + 1)
        if embedded:
            results.append({"chain": chain, "data": data, "note": "wrapper (contains embedded images)"})
            return
    results.append({"chain": chain, "data": data})


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: extract.py INPUT OUTDIR")
    src, outdir = sys.argv[1], sys.argv[2]
    data = open(src, "rb").read()
    results = []
    walk(data, [os.path.basename(src)], results)
    os.makedirs(outdir, exist_ok=True)
    manifest = {"schema": "game-cask/extract/1", "input": os.path.basename(src), "inputSha256": hashlib.sha256(data).hexdigest(), "files": []}
    used = set()
    for i, r in enumerate(results):
        if len(r["chain"]) == 1:
            continue  # the input itself
        name = name_for(r["data"], "file%03d.bin" % i)
        base = name
        k = 1
        while name.lower() in used:
            k += 1
            name = "%s.%d" % (base, k)
        used.add(name.lower())
        if "/" in name or name.startswith("."):
            name = "file%03d.bin" % i
        with open(os.path.join(outdir, name), "wb") as f:
            f.write(r["data"])
        manifest["files"].append({"name": name, "size": len(r["data"]), "sha256": hashlib.sha256(r["data"]).hexdigest(),
                                  "chain": r["chain"], "pe": is_pe(r["data"]), "note": r.get("note")})
    with open(os.path.join(outdir, "extract.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    for e in manifest["files"]:
        print("%-24s %9d  %s%s" % (e["name"], e["size"], " > ".join(e["chain"]), ("  (" + e["note"] + ")") if e["note"] else ""))


if __name__ == "__main__":
    main()
