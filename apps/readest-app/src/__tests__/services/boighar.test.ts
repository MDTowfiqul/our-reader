import { describe, test, expect, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));

import {
  fetchBoigharIndex,
  resolveBoigharEpubUrl,
  searchBoigharBooks,
  type BoigharBook,
} from '@/services/boighar';

const book = (overrides: Partial<BoigharBook> = {}): BoigharBook => ({
  title: 'Test Book',
  titleEn: 'Test Book',
  author: 'Test Author',
  language: 'en',
  cover: 'https://mdtowfiqul.github.io/our-boighar/img/cover.jpg',
  pageUrl: 'https://mdtowfiqul.github.io/our-boighar/books/test-book/',
  ...overrides,
});

describe('fetchBoigharIndex', () => {
  test('parses search.json entries into absolute URLs', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          title: 'আদাবে জিন্দেগী',
          title_en: 'Adab-e-Zindagi',
          author: 'ইউসুফ ইসলাহী',
          language: 'bn',
          cover: '/our-boighar/img/cover-adab-e-zindagi.jpg',
          url: '/our-boighar/books/adab-e-zindagi/',
        },
        { title: '', url: '/our-boighar/books/no-title/' },
        { title: 'No URL' },
        'not-an-object',
      ],
    });

    const index = await fetchBoigharIndex(fetchFn as never);

    expect(fetchFn).toHaveBeenCalledWith('https://mdtowfiqul.github.io/our-boighar/search.json');
    expect(index).toHaveLength(1);
    expect(index[0]).toEqual({
      title: 'আদাবে জিন্দেগী',
      titleEn: 'Adab-e-Zindagi',
      author: 'ইউসুফ ইসলাহী',
      language: 'bn',
      cover: 'https://mdtowfiqul.github.io/our-boighar/img/cover-adab-e-zindagi.jpg',
      pageUrl: 'https://mdtowfiqul.github.io/our-boighar/books/adab-e-zindagi/',
    });
  });

  test('returns [] when the index request fails', async () => {
    expect(await fetchBoigharIndex(vi.fn().mockResolvedValue({ ok: false }) as never)).toEqual([]);
    expect(
      await fetchBoigharIndex(vi.fn().mockRejectedValue(new Error('offline')) as never),
    ).toEqual([]);
    expect(
      await fetchBoigharIndex(
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ not: 'an array' }) }) as never,
      ),
    ).toEqual([]);
  });
});

describe('resolveBoigharEpubUrl', () => {
  const pageUrl = 'https://mdtowfiqul.github.io/our-boighar/books/al-quran-ek-mohabismoy/';

  test('uses the EPUB link found on the book page', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><a href="/books/al-quran-ek-mohabismoy.epub">Download</a></html>',
    });

    expect(await resolveBoigharEpubUrl(pageUrl, fetchFn as never)).toBe(
      'https://mdtowfiqul.github.io/our-boighar/books/al-quran-ek-mohabismoy.epub',
    );
  });

  test('uses an absolute EPUB link as-is', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><a href="https://mdtowfiqul.github.io/our-boighar/books/x.epub">EPUB</a></html>',
    });

    expect(await resolveBoigharEpubUrl(pageUrl, fetchFn as never)).toBe(
      'https://mdtowfiqul.github.io/our-boighar/books/x.epub',
    );
  });

  test('falls back to the conventional EPUB URL when the page has no EPUB link', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html></html>' });

    expect(await resolveBoigharEpubUrl(pageUrl, fetchFn as never)).toBe(
      'https://mdtowfiqul.github.io/our-boighar/books/al-quran-ek-mohabismoy.epub',
    );
  });

  test('falls back to the conventional EPUB URL when the page cannot be fetched', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));

    expect(await resolveBoigharEpubUrl(pageUrl, fetchFn as never)).toBe(
      'https://mdtowfiqul.github.io/our-boighar/books/al-quran-ek-mohabismoy.epub',
    );
  });
});

describe('searchBoigharBooks', () => {
  const books = [
    book({ title: 'আদাবে জিন্দেগী', titleEn: 'Adab-e-Zindagi', author: 'ইউসুফ ইসলাহী' }),
    book({ title: '100 Questions & Answers', titleEn: '100 Questions & Answers', author: 'Imran' }),
    book({ title: 'Al-Adab al-Mufrad', titleEn: 'Al-Adab al-Mufrad', author: 'Imam Bukhari' }),
  ];

  test('matches Bengali titles', () => {
    expect(searchBoigharBooks(books, 'জিন্দেগী')).toHaveLength(1);
  });

  test('matches the English title and author, case-insensitively', () => {
    expect(searchBoigharBooks(books, 'adab')).toHaveLength(2);
    expect(searchBoigharBooks(books, 'IMAM BUKHARI')).toHaveLength(1);
  });

  test('empty query returns everything', () => {
    expect(searchBoigharBooks(books, '  ')).toHaveLength(3);
  });

  test('no match returns []', () => {
    expect(searchBoigharBooks(books, 'zzz-no-such-book')).toEqual([]);
  });
});
