import test from "node:test";
import assert from "node:assert/strict";
import {
  createMangaDexSource,
  mapManga,
  mapChapter,
  SourceError,
} from "../src/services/mangadex/source.ts";

const id = "11111111-1111-4111-8111-111111111111";
const entity = {
  id,
  attributes: {
    title: { en: "English", "pt-br": "Português" },
    description: { en: "Description" },
    status: "ongoing",
    year: 2020,
    availableTranslatedLanguages: ["pt-br", "en", null],
  },
  relationships: [{ type: "cover_art", attributes: { fileName: "cover.jpg" } }],
};

function result(data: unknown[], offset = 0, total = 50, limit = 20) {
  return new Response(JSON.stringify({ data, offset, total, limit }), {
    status: 200,
  });
}

test("mapeia títulos, capas e capítulos sem expor a estrutura da API", () => {
  const manga = mapManga(entity);
  assert.equal(manga.title, "Português");
  assert.deepEqual(manga.languages, ["pt-br", "en"]);
  assert.equal(
    manga.coverUrl,
    `https://uploads.mangadex.org/covers/${id}/cover.jpg.256.jpg`,
  );
  assert.equal(
    mapManga({
      ...entity,
      relationships: [
        { type: "cover_art", attributes: { fileName: "../cover.jpg" } },
      ],
    }).coverUrl,
    null,
  );
  const chapter = mapChapter({
    id,
    attributes: { chapter: "1.5", translatedLanguage: "pt-br", pages: 12 },
    relationships: [
      { type: "scanlation_group", attributes: { name: "Grupo de teste" } },
    ],
  });
  assert.equal(chapter.number, "1.5");
  assert.deepEqual(chapter.groups, ["Grupo de teste"]);
  assert.throws(() => mapManga({ id: "invalido" }));
});

test("busca paginada codifica o texto e solicita relações e identificação do app", async () => {
  let calls = 0;
  const source = createMangaDexSource(async (url, options) => {
    calls++;
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://api.mangadex.org");
    assert.equal(parsed.searchParams.get("title"), "A & B");
    assert.equal(parsed.searchParams.get("offset"), "20");
    assert.equal(parsed.searchParams.get("includes[]"), "cover_art");
    assert.match(
      new Headers(options?.headers).get("User-Agent") ?? "",
      /MangaReader/,
    );
    return result([entity], 20);
  }, 0);
  assert.equal((await source.search("a")).items.length, 0);
  assert.equal(calls, 0);
  const page = await source.search(" A & B ", { offset: 20 });
  assert.equal(page.nextOffset, 40);
  assert.equal(page.items.length, 1);
});

test("lista capítulos por idioma e permite todos, com paginação finita", async () => {
  let calls = 0;
  const source = createMangaDexSource(async (url) => {
    const params = new URL(String(url)).searchParams;
    assert.equal(
      params.get("translatedLanguage[]"),
      calls++ === 0 ? "pt-br" : null,
    );
    assert.equal(params.get("includes[]"), "scanlation_group");
    assert.equal(params.get("includeExternalUrl"), "0");
    return result([], 0, 0, 50);
  }, 0);
  assert.equal((await source.chapters(id, "pt-br")).nextOffset, null);
  await source.chapters(id, null);
  await assert.rejects(source.getManga("../bad"), /Identificador inválido/);
});

test("respeita pausa após HTTP 429 e não repete automaticamente", async () => {
  let calls = 0;
  const source = createMangaDexSource(async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "30" } });
  }, 0);
  await assert.rejects(
    source.search("teste"),
    (error) => error instanceof SourceError && error.status === 429,
  );
  await assert.rejects(source.search("outro"), /pausa/);
  assert.equal(calls, 1);
});

test("cancelamento não envia consulta, e falha não bloqueia próximas consultas", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const source = createMangaDexSource(async () => {
    if (calls++ === 0) {
      throw new Error("network failed");
    }

    return result([entity]);
  }, 0);
  await assert.rejects(source.search("teste", { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
  await assert.rejects(source.search("teste"), /conexão/);
  assert.equal((await source.search("teste")).items.length, 1);
});

test("trata resposta HTTP e JSON fora do contrato com erros legíveis", async () => {
  const denied = createMangaDexSource(
    async () => new Response("", { status: 403 }),
    0,
  );
  await assert.rejects(denied.search("teste"), /recusou/);
  const malformed = createMangaDexSource(
    async () => new Response(JSON.stringify({ data: [], total: "muitos" })),
    0,
  );
  await assert.rejects(malformed.search("teste"), /paginação/);
});
