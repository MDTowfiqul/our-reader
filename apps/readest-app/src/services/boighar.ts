import { fetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

/**
 * Our Boighar — the free Islamic ebook library this reader serves
 * (https://mdtowfiqul.github.io/our-boighar/).
 *
 * The site publishes a `search.json` index of every book and a direct EPUB
 * download link on each book page. There is no OPDS feed (yet), so the app
 * reads the index for search and resolves each book page to its EPUB URL
 * for import — no Boighar-side change is needed for either path.
 */

export const BOIGHAR_BASE_URL = 'https://mdtowfiqul.github.io/our-boighar';
export const BOIGHAR_SEARCH_INDEX_URL = `${BOIGHAR_BASE_URL}/search.json`;

export interface BoigharBook {
  title: string;
  titleEn: string;
  author: string;
  language: string;
  /** Absolute cover image URL. */
  cover: string;
  /** Absolute book page URL. */
  pageUrl: string;
}

type FetchFn = typeof fetch;

const toAbsoluteUrl = (path: string): string => {
  try {
    return new URL(path, `${BOIGHAR_BASE_URL}/`).href;
  } catch {
    return path;
  }
};

/** Fetch the Boighar book index (`search.json`). Returns [] on any failure. */
export const fetchBoigharIndex = async (fetchFn?: FetchFn): Promise<BoigharBook[]> => {
  const fetchFunc = fetchFn ?? (isTauriAppPlatform() ? fetch : window.fetch);
  try {
    const res = await fetchFunc(BOIGHAR_SEARCH_INDEX_URL);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      )
      .map((entry) => ({
        title: typeof entry.title === 'string' ? entry.title : '',
        titleEn: typeof entry.title_en === 'string' ? entry.title_en : '',
        author: typeof entry.author === 'string' ? entry.author : '',
        language: typeof entry.language === 'string' ? entry.language : '',
        cover: typeof entry.cover === 'string' ? toAbsoluteUrl(entry.cover) : '',
        pageUrl: typeof entry.url === 'string' ? toAbsoluteUrl(entry.url) : '',
      }))
      .filter((book) => book.title && book.pageUrl);
  } catch {
    return [];
  }
};

/**
 * Resolve a Boighar book page to its direct EPUB download URL: read the first
 * `.epub` link off the page. Falls back to the site's conventional layout —
 * page `/books/<slug>/` → EPUB `/books/<slug>.epub` — when the page cannot be
 * read or carries no EPUB link.
 */
export const resolveBoigharEpubUrl = async (
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<string> => {
  const fetchFunc = fetchFn ?? (isTauriAppPlatform() ? fetch : window.fetch);
  try {
    const res = await fetchFunc(pageUrl);
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/href=["']([^"']+\.epub(?:\?[^"']*)?)["']/i);
      if (match?.[1]) {
        return new URL(match[1], pageUrl).href;
      }
    }
  } catch {
    // fall through to the conventional URL
  }
  return pageUrl.replace(/\/$/, '') + '.epub';
};

/** Case-insensitive title / English-title / author search over the index. */
export const searchBoigharBooks = (books: BoigharBook[], query: string): BoigharBook[] => {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter((book) =>
    [book.title, book.titleEn, book.author].some((field) => field.toLowerCase().includes(q)),
  );
};
