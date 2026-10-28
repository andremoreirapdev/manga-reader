import type { PageReport } from "../../types/manga-source";
import { checkCanceled, DownloadError } from "../../features/downloads/engine";

export type PageFetcher = (
  url: string,
  options: {
    signal: AbortSignal;
    headers: Record<string, string>;
    redirect: "follow";
  },
) => Promise<Pick<Response, "ok" | "status" | "headers" | "body" | "url"> & Partial<Pick<Response, "arrayBuffer">>>;
export type PageSink = {
  write(bytes: Uint8Array): Promise<void>;
  close(): void;
};
type TransferStage =
  | "headersMs"
  | "metadataMs"
  | "bodySetupMs"
  | "readMs"
  | "writeMs"
  | "cleanupMs"
  | "fileOpenMs"
  | "reportEnqueueMs"
  | "nativeBufferPages"
  | "streamPages";
const NATIVE_BUFFER_LIMIT = 4 * 1024 ** 2;
let blockedUntil = 0;

/** Também cancela a espera JS se o método nativo não rejeitar após um abort. */
function readNativeBuffer(read: () => Promise<ArrayBuffer>, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Leitura nativa cancelada."));
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      checkCanceled(signal);
      return read();
    }).then(
      (buffer) => {
        signal.removeEventListener("abort", abort);
        resolve(buffer);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function receivePage(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  fetcher: PageFetcher,
  openSink: () => PageSink,
  onBytes: (bytes: number, total: number) => void,
  report?: (value: PageReport) => Promise<void>,
  observe: (stage: TransferStage, milliseconds: number) => void = () => {},
  strategy: "stream" | "prefer-native-buffer" = "stream",
) {
  checkCanceled(signal);

  if (blockedUntil > Date.now()) {
    throw new DownloadError(
      `A fonte pediu uma pausa. Tente novamente em ${Math.ceil((blockedUntil - Date.now()) / 1000)} segundos.`,
    );
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 90000);
  const started = Date.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let sink: PageSink | undefined;
  let bytes = 0;
  let cached = false;
  let success = false;

  try {
    let response: Awaited<ReturnType<PageFetcher>>;

    try {
      response = await fetcher(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "MangaReader/0.1.0 (personal Android app)" },
      });
    } finally {
      // Meça quando o await realmente retoma, incluindo a espera da continuação JS.
      observe("headersMs", Date.now() - started);
    }

    // No Expo estes campos usam getters nativos; headers também recria Headers.
    // Tire um único snapshot para evitar repetir travessias JS/nativo por página.
    const readingMetadata = Date.now();
    const finalUrl = response.url;
    const status = response.status;
    const headers = response.headers;
    const secure = !finalUrl || new URL(finalUrl).protocol === "https:";
    cached = headers.get("x-cache")?.startsWith("HIT") ?? false;
    const declared = headers.get("content-length");
    const encoding = headers.get("content-encoding");
    const type = headers.get("content-type");
    const retry = status === 429 ? headers.get("retry-after") : null;
    const reset = status === 429 ? Number(headers.get("x-ratelimit-retry-after")) : 0;
    observe("metadataMs", Date.now() - readingMetadata);

    if (!secure) {
      throw new DownloadError(
        "A fonte retornou um endereço de imagem sem conexão segura.",
      );
    }

    if (status === 429) {
      const seconds = retry ? Number(retry) : NaN;
      blockedUntil = Number.isFinite(seconds)
        ? Date.now() + Math.max(1, seconds) * 1000
        : retry && Number.isFinite(Date.parse(retry))
          ? Date.parse(retry)
          : reset > 0
            ? reset * 1000
            : Date.now() + 60000;
      controller.abort();
      throw new DownloadError(
        "A fonte limitou os downloads. Aguarde antes de tentar novamente.",
      );
    }

    if (status < 200 || status >= 300) {
      controller.abort();
      throw new DownloadError(
        `Não foi possível obter a página (HTTP ${status}).`,
        status >= 500,
      );
    }

    const expected =
      declared === null || (encoding && encoding !== "identity")
        ? 0
        : Number(declared);

    if (
      (type &&
        !/^(image\/(jpe?g|png|webp)|application\/octet-stream)(;|$)/i.test(
          type,
        )) ||
      !Number.isFinite(expected) ||
      expected < 0 ||
      expected > maxBytes ||
      maxBytes <= 0
    ) {
      throw new DownloadError(
        "A página tem formato ou tamanho não suportado (máximo de 24 MiB por imagem).",
      );
    }

    const nativeBuffer = strategy === "prefer-native-buffer" && expected > 0 &&
      expected <= Math.min(maxBytes, NATIVE_BUFFER_LIMIT) && typeof response.arrayBuffer === "function";

    if (!nativeBuffer) {
      const openingBody = Date.now();
      const body = response.body;
      reader = body?.getReader();
      observe("bodySetupMs", Date.now() - openingBody);

      if (!reader) {
        throw new DownloadError("A fonte não retornou o conteúdo da página.");
      }
    }

    const opening = Date.now();

    try {
      sink = openSink();
    } catch {
      throw new DownloadError(
        "Não foi possível criar o arquivo da página. Confira o armazenamento do celular.",
      );
    } finally {
      observe("fileOpenMs", Date.now() - opening);
    }

    const writeChunk = async (chunk: Uint8Array) => {
      checkCanceled(signal);
      bytes += chunk.byteLength;

      if (bytes > maxBytes) {
        throw new DownloadError(
          "A página ultrapassou o limite permitido para o download.",
        );
      }

      try {
        const writing = Date.now();

        try {
          await sink!.write(chunk);
        } finally {
          observe("writeMs", Date.now() - writing);
        }
      } catch {
        throw new DownloadError(
          "Não foi possível gravar a página. Confira o espaço livre do celular.",
        );
      }

      onBytes(bytes, expected);
    };

    if (nativeBuffer) {
      // Uma única imagem com tamanho conhecido; nunca o capítulo inteiro em RAM.
      observe("nativeBufferPages", 1);
      const reading = Date.now();
      let buffer: ArrayBuffer;

      try {
        buffer = await readNativeBuffer(() => response.arrayBuffer!(), controller.signal);
      } finally {
        observe("readMs", Date.now() - reading);
      }

      checkCanceled(signal);

      if (buffer.byteLength > Math.min(maxBytes, NATIVE_BUFFER_LIMIT)) {
        bytes = buffer.byteLength;
        throw new DownloadError("A página ultrapassou o limite permitido para o download.");
      }

      if (buffer.byteLength !== expected) {
        bytes = buffer.byteLength;
        throw new DownloadError("A transferência da página ficou incompleta.", true);
      }

      await writeChunk(new Uint8Array(buffer));
    } else {
      observe("streamPages", 1);

      while (true) {
        checkCanceled(signal);
        const reading = Date.now();
        let chunk: ReadableStreamReadResult<Uint8Array>;

        try {
          chunk = await reader!.read();
        } finally {
          observe("readMs", Date.now() - reading);
        }

        if (chunk.done) break;

        await writeChunk(chunk.value);
      }
    }

    checkCanceled(signal);

    if (!bytes || (expected > 0 && expected !== bytes)) {
      throw new DownloadError(
        "A transferência da página ficou incompleta.",
        true,
      );
    }

    success = true;

    return bytes;
  } catch (error) {
    checkCanceled(signal);

    if (error instanceof DownloadError) throw error;

    throw new DownloadError(
      controller.signal.aborted
        ? "A página demorou demais para baixar."
        : "Falha de conexão ao baixar a página.",
      true,
    );
  } finally {
    const cleaning = Date.now();
    clearTimeout(timeout);
    controller.abort();
    signal.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
    sink?.close();
    observe("cleanupMs", Date.now() - cleaning);

    if (report) {
      const enqueueing = Date.now();
      await report({
        url,
        success,
        bytes,
        duration: Date.now() - started,
        cached,
      }).catch(() => {});
      observe("reportEnqueueMs", Date.now() - enqueueing);
    }
  }
}
