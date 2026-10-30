/**
 * Whole-book grounding for BookChat. The book's chapter texts are
 * extracted once per book and cached, then each question retrieves the
 * most relevant passages by keyword overlap — so answers can come from
 * anywhere in the book, not just the chapter being read. The context sent
 * to the model is capped, so cost stays bounded on long books.
 */

export type TocEntry = { id: number; label: string; subitems?: TocEntry[] };

/** Same section→chapter-title mapping the summary panel uses. */
export function chapterTitleFor(toc: TocEntry[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Chapter ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Chapter ${sectionIndex + 1}`;
}

/** Flatten a (possibly nested) TOC into document order. */
export function flattenToc(toc: TocEntry[] | undefined): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (items: TocEntry[] | undefined) => {
    for (const item of items || []) {
      out.push(item);
      walk(item.subitems);
    }
  };
  walk(toc);
  return out;
}

export interface BookChapter {
  sectionIndex: number;
  title: string;
  text: string;
}

export interface RetrievedPassage {
  chapterTitle: string;
  text: string;
}

const PASSAGE_CHARS = 1200;
/** Total context characters sent to the model per question. */
export const BOOK_CHAT_CONTEXT_CHARS = 24000;
/** Characters reserved for the chapter being read, always included. */
const CURRENT_CHAPTER_CHARS = 8000;

const STOPWORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'what',
  'when',
  'where',
  'which',
  'about',
  'does',
  'book',
  'chapter',
]);

function queryWords(question: string): string[] {
  const words = (question.toLowerCase().match(/[a-z0-9\u00C0-\u024F\u0980-\u09FF]+/gi) || [])
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function splitPassages(chapter: BookChapter): RetrievedPassage[] {
  const out: RetrievedPassage[] = [];
  const text = chapter.text;
  for (let start = 0; start < text.length; start += PASSAGE_CHARS) {
    let end = Math.min(start + PASSAGE_CHARS, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n\n', end);
      if (breakAt > start) end = breakAt;
    }
    const passage = text.slice(start, end).trim();
    if (passage) out.push({ chapterTitle: chapter.title, text: passage });
  }
  return out;
}

function scorePassage(passage: string, words: string[]): number {
  const lower = passage.toLowerCase();
  let score = 0;
  for (const word of words) {
    // Distinct-word matches matter most; extra occurrences add a little.
    const count = lower.split(word).length - 1;
    if (count > 0) score += 10 + Math.min(count, 5);
  }
  return score;
}

/**
 * Retrieve context for one question. The current chapter's opening
 * passages are always included first (up to CURRENT_CHAPTER_CHARS); the
 * remaining budget goes to the highest-scoring passages anywhere in the
 * book. With no keyword matches at all, the current chapter alone is
 * returned — never an empty context.
 */
export function retrievePassages(
  chapters: BookChapter[],
  currentSectionIndex: number,
  question: string,
): RetrievedPassage[] {
  const words = queryWords(question);
  const current = chapters.find((c) => c.sectionIndex === currentSectionIndex);
  const chosen: RetrievedPassage[] = [];
  let budget = BOOK_CHAT_CONTEXT_CHARS;

  if (current) {
    for (const passage of splitPassages(current)) {
      if (budget <= 0 || passage.text.length > CURRENT_CHAPTER_CHARS) break;
      if (chosen.reduce((n, p) => n + p.text.length, 0) >= CURRENT_CHAPTER_CHARS) break;
      chosen.push(passage);
      budget -= passage.text.length;
    }
  }

  if (words.length > 0 && budget > 0) {
    const scored = chapters
      .flatMap((c) => splitPassages(c))
      .map((p) => ({ passage: p, score: scorePassage(p.text, words) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { passage } of scored) {
      if (budget <= 0) break;
      if (chosen.some((p) => p.text === passage.text)) continue;
      if (passage.text.length > budget) continue;
      chosen.push(passage);
      budget -= passage.text.length;
    }
  }
  return chosen;
}

/** Render retrieved passages as labelled context for the system prompt. */
export function formatPassages(passages: RetrievedPassage[]): string {
  return passages.map((p) => `[${p.chapterTitle}]\n${p.text}`).join('\n\n');
}

// ---- Per-book chapter-text cache ---------------------------------------
// Keyed by bookKey; a changed section count means a different book (or a
// re-import), so the cached texts are dropped and re-extracted.
const chapterCache = new Map<string, { sectionCount: number; chapters: BookChapter[] }>();

export async function getBookChapters(
  bookKey: string,
  sectionCount: number,
  toc: TocEntry[] | undefined,
  loadSectionText: (sectionIndex: number) => Promise<string>,
): Promise<BookChapter[]> {
  const cached = chapterCache.get(bookKey);
  if (cached && cached.sectionCount === sectionCount) return cached.chapters;
  const chapters: BookChapter[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const text = await loadSectionText(i);
    if (text) chapters.push({ sectionIndex: i, title: chapterTitleFor(toc, i), text });
  }
  chapterCache.set(bookKey, { sectionCount, chapters });
  return chapters;
}
