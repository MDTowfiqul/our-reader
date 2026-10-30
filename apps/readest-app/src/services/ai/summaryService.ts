import { chatWithAI, summaryRouteId } from './customProviders';
import type { AISettings } from './types';

/**
 * Our Reader AI summaries (Stage 2a). On-demand only: nothing here ever
 * bulk-summarises a library. The caller supplies the text (one chapter, a
 * selection, or passages read so far); this service only calls the model
 * and caches the result. The user's OpenRouter key comes from AI settings
 * entered in-app — it is never hardcoded and never sent anywhere else.
 *
 * No native Gemini provider exists in this pass; Gemini models are
 * reachable through OpenRouter with the user's own key.
 */

export const SUMMARY_DISCLAIMER =
  'AI summary — may contain mistakes, not a religious ruling or authoritative interpretation';

export type SummaryLanguage = 'book' | 'bn' | 'en';
export type SummaryKind = 'chapter' | 'book' | 'selection' | 'so-far';

export interface SummaryPassage {
  chapterTitle: string;
  page: number;
  text: string;
}

export interface SummaryRequest {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  /** 'book' = the book's own language; 'bn' = Bengali; 'en' = English. */
  language: SummaryLanguage;
  kind: SummaryKind;
  /** Chapter title, for chapter summaries. */
  chapterTitle?: string;
  /** Section index, for chapter summaries (part of the cache key). */
  sectionIndex?: number;
  /** Full text for a chapter or a selection. */
  text?: string;
  /** Passages already read, for "what happened so far". */
  passages?: SummaryPassage[];
  /** Current page, for spoiler-safe "what happened so far". */
  currentPage?: number;
}

const CACHE_KEY = 'our-reader-summaries';
/** Max characters per model call when chunking a long chapter. */
const CHUNK_CHARS = 6000;
/** Max characters of read-so-far passages sent in one call. */
const SO_FAR_CHARS = 20000;

function languageInstruction(language: SummaryLanguage): string {
  switch (language) {
    case 'bn':
      return 'Write the summary in Bengali.';
    case 'en':
      return 'Write the summary in English.';
    case 'book':
    default:
      return "Write the summary in the book's original language.";
  }
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cacheKey(req: SummaryRequest, inputHash: string, routeId = ''): string {
  return [req.bookHash, req.kind, req.sectionIndex ?? '', req.language, routeId, inputHash].join(
    '|',
  );
}

function readCache(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCache(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const cache = readCache();
    cache[key] = value;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is best-effort; a full quota must not break summarising.
  }
}

function splitText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n\n', end);
      if (breakAt > start) end = breakAt;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

async function callModel(settings: AISettings, system: string, prompt: string): Promise<string> {
  // The user's custom system instruction, when set, frames every call.
  const custom = (settings.customSystemPrompt || '').trim();
  const fullSystem = custom ? `${custom}\n\n${system}` : system;
  return chatWithAI(settings, fullSystem, [{ role: 'user', content: prompt }]);
}

/** Summarise one passage of text (a chapter, or a user selection). */
export async function summarizeText(req: SummaryRequest, settings: AISettings): Promise<string> {
  const text = (req.text || '').trim();
  if (!text) throw new Error('No text to summarise');
  const key = cacheKey(req, hashText(text), summaryRouteId(settings));
  const cached = readCache()[key];
  if (cached) return cached;

  const lang = languageInstruction(req.language);
  let summary: string;
  if (text.length <= CHUNK_CHARS) {
    summary = await callModel(
      settings,
      `You summarise one passage of a book. ${lang} Keep it faithful to the passage only; do not invent details and do not reveal anything beyond the passage.`,
      `Book: "${req.bookTitle}"${req.authorName ? ` by ${req.authorName}` : ''}${req.chapterTitle ? `\nChapter: ${req.chapterTitle}` : ''}\n\n${text}`,
    );
  } else {
    // Map over chunk summaries, then reduce into one summary.
    const partials: string[] = [];
    for (const chunk of splitText(text, CHUNK_CHARS)) {
      partials.push(
        await callModel(
          settings,
          `You summarise one part of a chapter. ${lang} Keep it faithful to the part only.`,
          `Book: "${req.bookTitle}"${req.chapterTitle ? `\nChapter: ${req.chapterTitle}` : ''}\n\n${chunk}`,
        ),
      );
    }
    summary = await callModel(
      settings,
      `You combine part-summaries of one chapter into a single coherent summary. ${lang} Do not invent details beyond the part-summaries.`,
      `Book: "${req.bookTitle}"${req.chapterTitle ? `\nChapter: ${req.chapterTitle}` : ''}\n\n${partials.map((p, i) => `Part ${i + 1}:\n${p}`).join('\n\n')}`,
    );
  }
  writeCache(key, summary);
  return summary;
}

/**
 * Summarise the whole book from its per-chapter summaries (map-reduce).
 * Callers generate each chapter summary with summarizeText first; the
 * whole book is never sent to the model in a single call.
 */
export async function summarizeBookFromChapters(
  req: SummaryRequest,
  chapterSummaries: string[],
  settings: AISettings,
): Promise<string> {
  const joined = chapterSummaries.filter(Boolean).join('\n\n');
  if (!joined) throw new Error('No chapter summaries to combine');
  const key = cacheKey(req, hashText(joined), summaryRouteId(settings));
  const cached = readCache()[key];
  if (cached) return cached;
  const summary = await callModel(
    settings,
    `You combine chapter summaries into one whole-book summary. ${languageInstruction(req.language)} Do not invent details beyond the chapter summaries.`,
    `Book: "${req.bookTitle}"${req.authorName ? ` by ${req.authorName}` : ''}\n\n${chapterSummaries.map((s, i) => `Chapter ${i + 1}:\n${s}`).join('\n\n')}`,
  );
  writeCache(key, summary);
  return summary;
}

/**
 * "What happened so far": only passages up to the current page are used
 * (the existing spoiler rule from prompts.ts, applied here without the
 * chat backend). Passages beyond the current page are dropped, never sent.
 */
export async function summarizeSoFar(req: SummaryRequest, settings: AISettings): Promise<string> {
  const currentPage = req.currentPage ?? 0;
  const allowed = (req.passages || [])
    .filter((p) => currentPage <= 0 || p.page <= currentPage)
    .map((p) => `[${p.chapterTitle}, Page ${p.page}]\n${p.text}`)
    .join('\n\n');
  if (!allowed.trim()) throw new Error('No passages read so far to summarise');
  const trimmed = allowed.slice(0, SO_FAR_CHARS);
  const key = cacheKey(req, hashText(trimmed), summaryRouteId(settings));
  const cached = readCache()[key];
  if (cached) return cached;
  const summary = await callModel(
    settings,
    `You are a reading companion summarising only what the reader has read so far. ${languageInstruction(req.language)} You may ONLY use the passages below, which end at page ${currentPage}. NEVER discuss, hint at, or reveal anything beyond those passages, and never use outside knowledge of this book.`,
    `Book: "${req.bookTitle}"${req.authorName ? ` by ${req.authorName}` : ''}\n\n<BOOK_PASSAGES page_limit="${currentPage}">\n${trimmed}\n</BOOK_PASSAGES>`,
  );
  writeCache(key, summary);
  return summary;
}
