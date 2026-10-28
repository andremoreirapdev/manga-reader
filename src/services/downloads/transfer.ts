import type { PageReport } from "../../types/manga-source";
import { checkCanceled, DownloadError } from "../../features/downloads/engine";

export type PageFetcher = (
  url: string,
  options: {
    signal: AbortSignal;
    headers: Record<string, string>;
    redirect: "follow";
  },
) => Promise<Pick<Response, "ok" | "status" | "headers" | "body" | "url">>;
export type PageSink = {
  write(bytes: Uint8Array): Promise<void>;
  close(): void;
};
let blockedUntil = 0;

export async function receivePage(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  fetcher: PageFetcher,
  openSink: () => PageSink,
  onBytes: (bytes: number, total: number) => void,
  report?: (value: PageReport) => Promise<void>,
  observe: (stage: "headersMs" | "readMs" | "writeMs" | "cleanupMs", milliseconds: number) => void = () => {},
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
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "MangaReader/0.1.0 (personal Android app)" },
    }).finally(() => observe("headersMs", Date.now() - started));

    if (response.url && new URL(response.url).protocol !== "https:") {
      throw new DownloadError(
        "A fonte retornou um endereço de imagem sem conexão segura.",
      );
    }
    cached = response.headers.get("x-cache")?.startsWith("HIT") ?? false;

    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds = retry ? Number(retry) : NaN;
      const reset = Number(response.headers.get("x-ratelimit-retry-after"));
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

    if (!response.ok) {
      controller.abort();
      throw new DownloadError(
        `Não foi possível obter a página (HTTP ${response.status}).`,
        response.status >= 500,
      );
    }

    const declared = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    const expected =
      declared === null || (encoding && encoding !== "identity")
        ? 0
        : Number(declared);
    const type = response.headers.get("content-type");

    if (
      (type &&
        !/^(image\/(jpe?g|png|webp)|application\/octet-stream)(;|$)/i.test(
          type,
        )) ||
      !Number.isFinite(expected) ||
      expected < 0 ||
      expected > maxBytes ||
      maxBytes <= 0 ||
      !response.body
    ) {
      throw new DownloadError(
        "A página tem formato ou tamanho não suportado (máximo de 24 MiB por imagem).",
      );
    }

    reader = response.body.getReader();

    try {
      sink = openSink();
    } catch {
      throw new DownloadError(
        "Não foi possível criar o arquivo da página. Confira o armazenamento do celular.",
      );
    }

    while (true) {
      checkCanceled(signal);
      const reading = Date.now();
      const chunk = await reader.read().finally(() => observe("readMs", Date.now() - reading));

      if (chunk.done) break;

      bytes += chunk.value.byteLength;

      if (bytes > maxBytes) {
        throw new DownloadError(
          "A página ultrapassou o limite permitido para o download.",
        );
      }

      try {
        const writing = Date.now();
        await sink.write(chunk.value).finally(() => observe("writeMs", Date.now() - writing));
      } catch {
        throw new DownloadError(
          "Não foi possível gravar a página. Confira o espaço livre do celular.",
        );
      }

      onBytes(bytes, expected);
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
      await report({
        url,
        success,
        bytes,
        duration: Date.now() - started,
        cached,
      }).catch(() => {});
    }
  }
}
