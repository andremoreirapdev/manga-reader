import { zipSync, strToU8 } from "fflate";
import { writeFileSync, mkdirSync } from "node:fs";
// Páginas SVG não são suportadas: imagens PNG reais geradas com zlib nativo.
import { deflateSync } from "node:zlib";
import { crc32 } from "../src/services/zip.ts";
function chunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(n: number) {
  const w = 320,
    h = 480,
    header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * (w * 3 + 1) + 1 + x * 3;
      raw[p] = n * 65;
      raw[p + 1] = 60 + Math.floor((y / h) * 130);
      raw[p + 2] = x < 80 * n && x % 80 < 40 ? 240 : 80;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
mkdirSync("fixtures", { recursive: true });
writeFileSync(
  "fixtures/teste.cbz",
  zipSync({
    "10.png": png(3),
    "2.png": png(2),
    "1.png": png(1),
    "leia.txt": strToU8("Ordem esperada: 1, 2, 10. Barras claras: 1, 2, 3."),
  }),
);
console.log("Criado fixtures/teste.cbz (três páginas sintéticas).");

