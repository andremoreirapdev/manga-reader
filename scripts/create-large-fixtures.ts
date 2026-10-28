import { Zip, ZipPassThrough, zipSync, strToU8 } from 'fflate';
import { openSync, closeSync, writeSync, readSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32, indexZip, extractPage } from '../src/services/zip.ts';

const width = 800, height = 1200, count = 100;
const digits = [
  ['11111','10001','10001','10001','10001','10001','11111'],
  ['00100','01100','00100','00100','00100','00100','01110'],
  ['11111','00001','00001','11111','10000','10000','11111'],
  ['11111','00001','00001','11111','00001','00001','11111'],
  ['10001','10001','10001','11111','00001','00001','00001'],
  ['11111','10000','10000','11111','00001','00001','11111'],
  ['11111','10000','10000','11111','10001','10001','11111'],
  ['11111','00001','00010','00100','01000','01000','01000'],
  ['11111','10001','10001','11111','10001','10001','11111'],
  ['11111','10001','10001','11111','00001','00001','11111'],
];
function chunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function page(number: number) {
  // Grayscale PNG: textura determinística para o arquivo não ficar artificialmente pequeno.
  const stride = width + 1, raw = Buffer.alloc(stride * height);
  let seed = number;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const border = x < 20 || x >= width - 20 || y < 20 || y >= height - 20;
    raw[y * stride + x + 1] = border ? 24 : 120 + ((seed >>> 0) % 16) * 8;
  }
  function rect(x: number, y: number, w: number, h: number, value: number) {
    for (let row = y; row < y + h; row++) raw.fill(value, row * stride + x + 1, row * stride + x + w + 1);
  }
  rect(50, 75, 700, 270, 245);
  const label = String(number).padStart(3, '0'), scale = 28;
  for (let n = 0; n < label.length; n++) {
    const glyph = digits[Number(label[n])];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (glyph[y][x] === '1') rect(162 + n * 168 + x * scale, 110 + y * scale, scale, scale, 20);
  }
  // Molduras para acompanhar a rolagem vertical e identificar o fim da página.
  for (let y = 400; y < 1000; y += 230) {
    rect(60, y, 680, 7, 30); rect(60, y + 190, 680, 7, 30);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}
mkdirSync('fixtures', {recursive:true});
const target = 'fixtures/teste-100-paginas.cbz';
const output = openSync(target, 'w');
try {
  const zip = new Zip((error, data) => { if (error) throw error; writeSync(output, data); });
  // Ordem física invertida para verificar a ordenação numérica do importador.
  for (let n = count; n >= 1; n--) {
    const entry = new ZipPassThrough(`paginas/${n}.png`); zip.add(entry); entry.push(page(n), true);
  }
  zip.end();
} finally { closeSync(output); }
const invalid = zipSync({'leia-me.txt': strToU8('Arquivo de teste sem imagens. A importação como CBZ deve falhar. Nenhum código executável.')});
writeFileSync('fixtures/invalido-sem-imagens.zip', invalid);
writeFileSync('fixtures/invalido-sem-imagens.cbz', invalid);
const fd = openSync(target, 'r');
try {
  const read = (offset: number, size: number) => { const bytes = Buffer.alloc(size); if (readSync(fd, bytes, 0, size, offset) !== size) throw new Error('Leitura incompleta'); return bytes; };
  const entries = indexZip(read, statSync(target).size);
  if (entries.length !== count) throw new Error('Contagem incorreta');
  for (let i = 0; i < count; i++) {
    if (entries[i].name !== `paginas/${i+1}.png`) throw new Error('Ordem incorreta');
    extractPage(read, entries[i]);
  }
  let rejected = false;
  try { indexZip((offset,size) => invalid.subarray(offset,offset+size), invalid.length); } catch { rejected = true; }
  if (!rejected) throw new Error('Arquivo inválido não foi rejeitado');
} finally { closeSync(fd); }
console.log(`Validado: ${count} páginas PNG ${width}x${height}, ${(statSync(target).size/1024**2).toFixed(1)} MiB; ordem, assinatura e CRC de todas as páginas conferidos. ZIP sem imagens rejeitado.`);

