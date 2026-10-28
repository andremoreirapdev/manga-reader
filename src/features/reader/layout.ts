export type PageSize = { width: number; height: number };
/** Lê somente cabeçalhos de PNG, JPEG e WebP; não decodifica pixels. */
export function imageSize(bytes: Uint8Array): PageSize {
  let width = 0, height = 0;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));

  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 3) === "PNG") {
    width = d.getUint32(16);
    height = d.getUint32(20);
  } else if (
    bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP"
  ) {
    const kind = text(12, 4);

    if (kind === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = d.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (
      kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a
    ) {
      width = d.getUint16(26, true) & 0x3fff;
      height = d.getUint16(28, true) & 0x3fff;
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 3 < bytes.length) {
      if (bytes[p++] !== 255) break;

      while (bytes[p] === 255) p++;

      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > bytes.length) break;

      const length = d.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;

      const validMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
      
      if (validMarkers.includes(marker) && length >= 7) {
        height = d.getUint16(p + 3);
        width = d.getUint16(p + 5);
        break;
      }

      p += length;
    }
  }

  if (!width || !height)
    throw new Error("Não foi possível identificar as dimensões desta página.");
  return { width, height };
}

export function pageLayouts(sizes: PageSize[], width: number) {
  let offset = 0;
  return sizes.map((size, index) => {
    const length = (width * size.height) / size.width;
    const item = { index, offset, length };
    offset += length;
    return item;
  });
}
