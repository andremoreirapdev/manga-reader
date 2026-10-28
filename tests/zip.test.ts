import test from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { extractPage, indexZip, safePath } from "../src/services/zip.ts";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

const read = (bytes: Uint8Array) => (offset: number, length: number) =>
  bytes.slice(offset, offset + length);

test("ordena páginas numericamente e extrai stored/deflate com CRC", () => {
  for (const level of [0, 6] as const) {
    const zip = zipSync(
      {
        "10.png": png,
        "2.png": png,
        "1.png": png,
        "notes.txt": new Uint8Array([1]),
      },
      { level },
    );
    const entries = indexZip(read(zip), zip.length);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["1.png", "2.png", "10.png"],
    );
    assert.deepEqual(extractPage(read(zip), entries[0]), png);
  }
});

test("rejeita caminhos perigosos", () => {
  for (const name of [
    "../a.png",
    "/a.png",
    "C:/a.png",
    "a\\b.png",
    "a/../b.png",
    "./a.png",
  ]) {
    assert.equal(safePath(name), false);
    const zip = zipSync({ [name]: png });
    assert.throws(() => indexZip(read(zip), zip.length));
  }
});

test("rejeita ZIP truncado, sem imagens, criptografado, ZIP64 e imagem falsa", () => {
  const zip = zipSync({ "1.png": png });
  assert.throws(() => indexZip(read(zip.subarray(0, -1)), zip.length - 1));
  const empty = zipSync({ "notes.txt": png });
  assert.throws(() => indexZip(read(empty), empty.length));
  const fake = zipSync({ "1.png": new Uint8Array([1, 2, 3]) });
  assert.throws(() =>
    extractPage(read(fake), indexZip(read(fake), fake.length)[0]),
  );
  const entries = indexZip(read(zip), zip.length);
  assert.throws(() => extractPage(read(zip), { ...entries[0], crc: 0 }));
  assert.throws(() => extractPage(read(zip), { ...entries[0], size: 1 }));
  const encrypted = zip.slice();
  const d = new DataView(encrypted.buffer);
  for (let i = 0; i < encrypted.length - 4; i++) {
    if (d.getUint32(i, true) === 0x02014b50) {
      d.setUint16(i + 8, 1, true);
      break;
    }
  }
  assert.throws(() => indexZip(read(encrypted), encrypted.length));
  const zip64 = zip.slice();
  new DataView(zip64.buffer).setUint32(zip64.length - 6, 0xffffffff, true);
  assert.throws(() => indexZip(read(zip64), zip64.length));
});
