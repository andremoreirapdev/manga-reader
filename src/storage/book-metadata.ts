export type MangaMetadata = {
  sourceMangaId: string;
  mangaTitle: string;
  chapterNumber: string | null;
  chapterLanguage: string | null;
};

/** Recupera apenas a identidade explícita salva no pedido de download antigo. */
export function metadataFromDownload(request: string, chapterId: string): MangaMetadata | null {
  try {
    const value = JSON.parse(request);
    const manga = value?.manga;
    const chapter = value?.chapter;

    if (chapter?.id !== chapterId || typeof manga?.id !== "string" ||
      !manga.id.trim() || typeof manga.title !== "string" || !manga.title.trim()) return null;

    return {
      sourceMangaId: manga.id,
      mangaTitle: manga.title,
      chapterNumber: typeof chapter.number === "string" && chapter.number ? chapter.number : null,
      chapterLanguage: typeof chapter.language === "string" && chapter.language ? chapter.language : null,
    };
  } catch {
    return null;
  }
}
