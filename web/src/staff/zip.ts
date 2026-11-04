// Minimal stored (uncompressed) zip writer: enough for the demo download path.
// The real backend serves the zip; the mock builds one from data-URL images.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const put = (buf: Uint8Array) => {
    chunks.push(buf);
    offset += buf.length;
  };
  const head = (len: number) => new DataView(new ArrayBuffer(len));

  files.forEach((f) => {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = head(30);
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true); // stored
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    const localOffset = offset;
    put(new Uint8Array(lh.buffer));
    put(name);
    put(f.data);

    const ch = head(46);
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint32(24, crc, true);
    ch.setUint32(28, f.data.length, true);
    ch.setUint32(32, f.data.length, true);
    ch.setUint16(36, name.length, true);
    ch.setUint32(42, localOffset, true);
    central.push(new Uint8Array(ch.buffer), name);
  });

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c);
    centralSize += c.length;
  }
  offset += centralSize;
  const end = head(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end.buffer));

  const out = new Uint8Array(offset + 22);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
