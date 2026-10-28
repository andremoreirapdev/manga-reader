import { createMangaDexSource } from "../src/services/mangadex/source.ts";

async function check() {
  const source = createMangaDexSource();
  const results = await source.search("Yotsuba&!");
  console.log(`Busca: ${results.items.length} de ${results.total} resultados.`);

  if (!results.items[0]) {
    throw new Error(
      "A API respondeu, mas o título de teste não foi encontrado.",
    );
  }

  const manga = await source.getManga(results.items[0].id);
  const chapters = await source.chapters(manga.id, "pt-br");
  console.log(
    JSON.stringify({
      title: manga.title,
      languages: manga.languages,
      hasCover: !!manga.coverUrl,
      chapterTotal: chapters.total,
      chapterCount: chapters.items.length,
    }),
  );
}

check().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
