import type {
  Chapter,
  ChapterPages,
  Manga,
  MangaSource,
  PageRequest,
  SourcePage,
} from "../../types/manga-source";

const API = "https://api.mangadex.org";
export const USER_AGENT = "MangaReader/0.1.0 (personal Android app)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapChapterPages(value: unknown): ChapterPages {
  const body = record(value);
  const chapter = record(body.chapter);
  const baseUrl = text(body.baseUrl);
  let base: URL;

  try {
    base = new URL(baseUrl);
  } catch {
    throw new SourceError(
      "O MangaDex retornou um servidor de páginas inválido.",
    );
  }
  const revision = text(chapter.hash);

  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !/^[a-f0-9]{32,64}$/i.test(revision) ||
    !Array.isArray(chapter.data) ||
    chapter.data.length === 0 ||
    chapter.data.length > 5000
  ) {
    throw new SourceError(
      "O MangaDex não disponibilizou páginas válidas para este capítulo.",
    );
  }

  return {
    revision,
    expiresAt: Date.now() + 14 * 60 * 1000,
    pages: chapter.data.map((value) => {
      const filename = text(value);

      if (!/^[a-zA-Z0-9_-]+\.(jpe?g|png|webp)$/i.test(filename)) {
        throw new SourceError(
          "O MangaDex retornou um nome de página inválido.",
        );
      }

      return {
        url: `${baseUrl.replace(/\/$/, "")}/data/${revision}/${encodeURIComponent(filename)}`,
        extension: filename.split(".").pop()!.toLowerCase(),
      };
    }),
  };
}

export class SourceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceError("O MangaDex retornou dados inesperados.");
  }

  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function localized(value: unknown): string {
  const values = record(value ?? {});

  return (
    text(values["pt-br"]) ||
    text(values.pt) ||
    text(values.en) ||
    Object.values(values).map(text).find(Boolean) ||
    ""
  );
}

function relationships(
  value: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(value.relationships)
    ? value.relationships.map(record)
    : [];
}

function identifier(value: unknown): string {
  const id = text(value);

  if (!UUID.test(id)) {
    throw new SourceError("Identificador inválido do MangaDex.");
  }

  return id;
}

export function mapManga(value: unknown): Manga {
  const entity = record(value);
  const attributes = record(entity.attributes);
  const id = identifier(entity.id);
  const cover = relationships(entity).find((item) => item.type === "cover_art");
  const filename = cover?.attributes
    ? text(record(cover.attributes).fileName)
    : "";
  const safeFilename = /^[a-zA-Z0-9_-]+\.(jpe?g|png|webp)$/i.test(filename);

  return {
    id,
    title: localized(attributes.title) || "Sem título",
    description: localized(attributes.description),
    coverUrl: safeFilename
      ? `https://uploads.mangadex.org/covers/${id}/${encodeURIComponent(filename)}.256.jpg`
      : null,
    status: text(attributes.status),
    year: typeof attributes.year === "number" ? attributes.year : null,
    languages: Array.isArray(attributes.availableTranslatedLanguages)
      ? attributes.availableTranslatedLanguages.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
}

export function mapChapter(value: unknown): Chapter {
  const entity = record(value);
  const attributes = record(entity.attributes);

  return {
    id: identifier(entity.id),
    title: text(attributes.title),
    number: text(attributes.chapter) || null,
    volume: text(attributes.volume) || null,
    language: text(attributes.translatedLanguage),
    pages: typeof attributes.pages === "number" ? attributes.pages : 0,
    groups: relationships(entity)
      .filter((item) => item.type === "scanlation_group")
      .map((item) =>
        item.attributes ? text(record(item.attributes).name) : "",
      )
      .filter(Boolean),
    external: Boolean(attributes.externalUrl),
  };
}

function page<T>(value: unknown, map: (item: unknown) => T): SourcePage<T> {
  const body = record(value);

  if (
    !Array.isArray(body.data) ||
    !Number.isInteger(body.total) ||
    !Number.isInteger(body.limit) ||
    !Number.isInteger(body.offset) ||
    Number(body.limit) <= 0 ||
    Number(body.total) < 0 ||
    Number(body.offset) < 0
  ) {
    throw new SourceError("A paginação retornada pelo MangaDex é inválida.");
  }

  const next = Number(body.offset) + Number(body.limit);

  return {
    items: body.data.map(map),
    total: Number(body.total),
    nextOffset:
      body.data.length > 0 && next < Number(body.total) && next < 10000
        ? next
        : null,
  };
}

function aborted() {
  const error = new Error("Consulta cancelada.");
  error.name = "AbortError";

  return error;
}

export function createMangaDexSource(
  fetcher: typeof fetch = fetch,
  intervalMs = 1000,
): MangaSource {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStarted = 0;
  let blockedUntil = 0;

  function request(
    path: string,
    params: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const task = queue.then(async () => {
      if (signal?.aborted) {
        throw aborted();
      }

      if (blockedUntil > Date.now()) {
        throw new SourceError(
          `O MangaDex pediu uma pausa. Tente novamente em ${Math.ceil((blockedUntil - Date.now()) / 1000)} segundos.`,
          429,
        );
      }

      const delay = Math.max(0, lastStarted + intervalMs - Date.now());

      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (signal?.aborted) {
        throw aborted();
      }

      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 20000);
      lastStarted = Date.now();

      try {
        const response = await fetcher(`${API}${path}?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        });

        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const reset = Number(response.headers.get("x-ratelimit-retry-after"));
          const seconds = retry === null ? NaN : Number(retry);
          blockedUntil = Number.isFinite(seconds)
            ? Date.now() + Math.max(1, seconds) * 1000
            : retry && Number.isFinite(Date.parse(retry))
              ? Date.parse(retry)
              : reset > 0
                ? reset * 1000
                : Date.now() + 60000;
          blockedUntil = Math.max(Date.now() + 1000, blockedUntil);

          throw new SourceError(
            "O MangaDex limitou as consultas. Aguarde antes de tentar novamente.",
            429,
          );
        }

        if (!response.ok) {
          throw new SourceError(
            response.status === 403
              ? "O MangaDex recusou o acesso. Não é possível consultar a fonte agora."
              : response.status === 404
                ? "Este título não está disponível no MangaDex."
                : `O MangaDex está indisponível (HTTP ${response.status}).`,
            response.status,
          );
        }

        return await response.json();
      } catch (error) {
        if (signal?.aborted) {
          throw aborted();
        }

        if (error instanceof SourceError) {
          throw error;
        }

        throw new SourceError(
          controller.signal.aborted
            ? "A consulta demorou demais. Tente novamente."
            : "Não foi possível consultar o MangaDex. Verifique sua conexão.",
        );
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
      }
    });
    queue = task.catch(() => {});

    return task;
  }

  function pagination(request: PageRequest, limit: number) {
    const offset = request.offset ?? 0;

    if (!Number.isInteger(offset) || offset < 0 || offset >= 10000) {
      throw new SourceError("Página de resultados inválida.");
    }

    return new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
  }

  return {
    id: "mangadex",
    name: "MangaDex",
    async getChapterPages(id, signal) {
      identifier(id);

      return mapChapterPages(
        await request(
          `/at-home/server/${id}`,
          new URLSearchParams({ forcePort443: "true" }),
          signal,
        ),
      );
    },
    async reportPage(report) {
      const host = new URL(report.url).hostname;

      if (host === "mangadex.org" || host.endsWith(".mangadex.org")) {
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetcher("https://api.mangadex.network/report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
          },
          body: JSON.stringify(report),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new SourceError("O servidor não aceitou o relatório da página.", response.status);
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    async search(title, options = {}) {
      if (title.trim().length < 2) {
        return { items: [], total: 0, nextOffset: null };
      }

      const params = pagination(options, 20);
      params.set("title", title.trim());
      params.set("includes[]", "cover_art");
      params.set("order[relevance]", "desc");
      params.append("contentRating[]", "safe");
      params.append("contentRating[]", "suggestive");

      return page(await request("/manga", params, options.signal), mapManga);
    },
    async getManga(id, signal) {
      identifier(id);
      const params = new URLSearchParams({ "includes[]": "cover_art" });
      const body = record(await request(`/manga/${id}`, params, signal));

      return mapManga(body.data);
    },
    async chapters(id, language, options = {}) {
      identifier(id);
      const params = pagination(options, 50);
      params.set("includes[]", "scanlation_group");
      params.set("order[volume]", "asc");
      params.set("order[chapter]", "asc");
      params.set("includeFutureUpdates", "0");
      params.set("includeFuturePublishAt", "0");
      params.set("includeExternalUrl", "0");

      if (language) {
        params.set("translatedLanguage[]", language);
      }

      return page(
        await request(`/manga/${id}/feed`, params, options.signal),
        mapChapter,
      );
    },
  };
}
