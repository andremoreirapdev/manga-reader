import test from "node:test";
import assert from "node:assert/strict";
import { imageSize, pageLayouts } from "../src/features/reader/layout.ts";

test("lê dimensões PNG, JPEG baseline/progressivo e variantes WebP", () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71]);
  const pd = new DataView(png.buffer);
  pd.setUint32(16, 800);
  pd.setUint32(20, 1200);
  assert.deepEqual(imageSize(png), { width: 800, height: 1200 });

  for (const marker of [0xc0, 0xc2]) {
    const jpeg = new Uint8Array([
      255,
      216,
      255,
      224,
      0,
      4,
      0,
      0,
      255,
      marker,
      0,
      7,
      8,
      4,
      176,
      3,
      32,
    ]);
    assert.deepEqual(imageSize(jpeg), { width: 800, height: 1200 });
  }

  for (const kind of ["VP8X", "VP8L", "VP8 "]) {
    const bytes = new Uint8Array(30);
    const d = new DataView(bytes.buffer);
    bytes.set(Buffer.from("RIFF"), 0);
    bytes.set(Buffer.from("WEBP"), 8);
    bytes.set(Buffer.from(kind), 12);

    if (kind === "VP8X") {
      bytes[24] = 31;
      bytes[25] = 3;
      bytes[27] = 175;
      bytes[28] = 4;
    }

    if (kind === "VP8L") {
      bytes[20] = 0x2f;
      d.setUint32(21, 799 | (1199 << 14), true);
    }

    if (kind === "VP8 ") {
      bytes.set([0x9d, 1, 0x2a], 23);
      d.setUint16(26, 800, true);
      d.setUint16(28, 1200, true);
    }
    assert.deepEqual(imageSize(bytes), { width: 800, height: 1200 });
  }
});

test("rejeita dimensões ausentes e JPEG truncado", () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([255, 216, 255, 192, 255, 255]),
  ])
    assert.throws(() => imageSize(bytes));
});

test("posiciona páginas de alturas diferentes sem lacunas, inclusive ao mudar largura", () => {
  const sizes = [
    { width: 800, height: 1200 },
    { width: 400, height: 2400 },
    { width: 1200, height: 800 },
  ];
  assert.deepEqual(pageLayouts(sizes, 400), [
    { index: 0, offset: 0, length: 600 },
    { index: 1, offset: 600, length: 2400 },
    { index: 2, offset: 3000, length: 800 / 3 },
  ]);
  const rotated = pageLayouts(sizes, 800);
  assert.equal(rotated[2].offset, 6000);
});
