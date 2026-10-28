import { Inflate, strFromU8 } from "fflate";

export type Entry = {
  name: string;
  size: number;
  compressed: number;
  offset: number;
  method: number;
  crc: number;
  flags: number;
  limit: number;
};
export type Read = (offset: number, length: number) => Uint8Array;
const MAX_PAGE = 24 * 1024 * 1024;
const fail = (): never => {
  throw new Error("CBZ inválido, corrompido ou fora dos limites suportados.");
};
const view = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);
export function safePath(name: string) {
  return (
    !!name &&
    !/[\\:\x00-\x1f]/.test(name) &&
    !name.startsWith("/") &&
    !name.split("/").some((p) => p === ".." || p === ".")
  );
}
export function indexZip(read: Read, length: number): Entry[] {
  if (length < 22 || length > 2 * 1024 ** 3) return fail();
  const start = Math.max(0, length - 65557),
    tail = read(start, length - start),
    t = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (
      t.getUint32(i, true) === 0x06054b50 &&
      i + 22 + t.getUint16(i + 20, true) === tail.length
    ) {
      end = i;
      break;
    }
  if (end < 0) return fail();
  const count = t.getUint16(end + 10, true),
    bytes = t.getUint32(end + 12, true),
    offset = t.getUint32(end + 16, true);
  if (
    t.getUint16(end + 4, true) ||
    t.getUint16(end + 6, true) ||
    t.getUint16(end + 8, true) !== count ||
    count > 10000 ||
    bytes > 8 * 1024 ** 2 ||
    offset + bytes !== start + end
  )
    return fail();
  const central = read(offset, bytes),
    d = view(central),
    entries: Entry[] = [],
    names = new Set<string>();
  let p = 0,
    total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes || d.getUint32(p, true) !== 0x02014b50) return fail();
    const flags = d.getUint16(p + 8, true),
      method = d.getUint16(p + 10, true),
      crc = d.getUint32(p + 16, true),
      compressed = d.getUint32(p + 20, true),
      size = d.getUint32(p + 24, true);
    const nl = d.getUint16(p + 28, true),
      extra = d.getUint16(p + 30, true),
      comment = d.getUint16(p + 32, true),
      local = d.getUint32(p + 42, true);
    if (p + 46 + nl + extra + comment > bytes) return fail();
    const name = strFromU8(central.subarray(p + 46, p + 46 + nl));
    if (
      !safePath(name) ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      d.getUint16(p + 34, true) ||
      ((d.getUint32(p + 38, true) >>> 16) & 0xf000) === 0xa000 ||
      local + 30 > offset
    )
      return fail();
    if (/\.(jpe?g|png|webp)$/i.test(name) && !name.startsWith("__MACOSX/")) {
      if (
        names.has(name) ||
        !size ||
        size > MAX_PAGE ||
        compressed > MAX_PAGE ||
        compressed === 0 ||
        size / compressed > 300 ||
        local + 30 + compressed > offset
      )
        return fail();
      names.add(name);
      total += size;
      if (total > 4 * 1024 ** 3 || entries.length >= 5000) return fail();
      entries.push({
        name,
        size,
        compressed,
        offset: local,
        method,
        crc,
        flags,
        limit: offset,
      });
    }
    p += 46 + nl + extra + comment;
  }
  if (p !== bytes || !entries.length) return fail();
  return entries.sort((a, b) =>
    a.name.localeCompare(b.name, "en", {
      numeric: true,
      sensitivity: "variant",
    }),
  );
}
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function extractPage(read: Read, e: Entry): Uint8Array {
  const h = view(read(e.offset, 30));
  if (
    h.getUint32(0, true) !== 0x04034b50 ||
    h.getUint16(6, true) !== e.flags ||
    h.getUint16(8, true) !== e.method
  )
    return fail();
  const nl = h.getUint16(26, true),
    extra = h.getUint16(28, true);
  if (strFromU8(read(e.offset + 30, nl)) !== e.name) return fail();
  const offset = e.offset + 30 + nl + extra;
  if (offset + e.compressed > e.limit) return fail();
  const output = new Uint8Array(e.size);
  let written = 0;
  const put = (chunk: Uint8Array) => {
    if (written + chunk.length > e.size) return fail();
    output.set(chunk, written);
    written += chunk.length;
  };
  const inflater = new Inflate(put);
  for (let p = 0; p < e.compressed; p += 65536) {
    const chunk = read(offset + p, Math.min(65536, e.compressed - p));
    if (e.method === 0) put(chunk);
    else inflater.push(chunk, p + chunk.length === e.compressed);
  }
  if (written !== e.size || crc32(output) !== e.crc) return fail();
  const png = output[0] === 137 && strFromU8(output.subarray(1, 4)) === "PNG";
  const jpg = output[0] === 255 && output[1] === 216 && output[2] === 255;
  const webp =
    strFromU8(output.subarray(0, 4)) === "RIFF" &&
    strFromU8(output.subarray(8, 12)) === "WEBP";
  if (!(/\.png$/i.test(e.name) ? png : /\.webp$/i.test(e.name) ? webp : jpg))
    return fail();
  return output;
}
