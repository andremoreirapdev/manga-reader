import { imageSize } from "../reader/layout";
import { DownloadError } from "./engine";

export function validateDownloadedImage(bytes: Uint8Array, extension: string) {
  const string = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  const png =
    bytes.length > 40 &&
    bytes[0] === 137 &&
    string(1, 8) === "PNG\r\n\x1a\n" &&
    string(bytes.length - 8, bytes.length - 4) === "IEND";
  const jpeg =
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217;
  const webp =
    bytes.length >= 30 &&
    string(0, 4) === "RIFF" &&
    string(8, 12) === "WEBP" &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      4,
      true,
    ) +
      8 <=
      bytes.length;

  if (
    !(extension === "png"
      ? png
      : extension === "webp"
        ? webp
        : /^jpe?g$/.test(extension) && jpeg)
  ) {
    throw new DownloadError(
      "A fonte retornou uma imagem inválida ou incompleta.",
    );
  }

  const size = imageSize(bytes);

  if (size.width * size.height > 64 * 1024 ** 2) {
    throw new DownloadError(
      "A imagem possui dimensões acima do limite de memória suportado.",
    );
  }

  return size;
}
