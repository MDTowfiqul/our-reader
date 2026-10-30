import { describe, test, expect } from 'vitest';
import {
  BOOK_CHAT_CONTEXT_CHARS,
  chapterTitleFor,
  flattenToc,
  retrievePassages,
  type BookChapter,
} from '@/services/ai/bookRetrieval';

const chapters: BookChapter[] = [
  {
    sectionIndex: 0,
    title: 'Chapter One',
    text: 'The market was loud. ' + 'A merchant sold dates and figs. '.repeat(40),
  },
  {
    sectionIndex: 1,
    title: 'Chapter Two',
    text: 'The caravan crossed the desert at night. The stars guided them home. '.repeat(40),
  },
  {
    sectionIndex: 2,
    title: 'Chapter Three',
    text: 'Rain fell on the harbour. Ships waited for the tide. '.repeat(40),
  },
];

describe('bookRetrieval', () => {
  test('answers can come from anywhere: a question about the desert retrieves chapter two', () => {
    const passages = retrievePassages(chapters, 0, 'How did the caravan cross the desert?');
    expect(passages.some((p) => p.chapterTitle === 'Chapter Two')).toBe(true);
  });

  test('the current chapter is always included even with no keyword match', () => {
    const passages = retrievePassages(chapters, 2, 'What is quantum entanglement?');
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.chapterTitle).toBe('Chapter Three');
  });

  test('context stays within the cap', () => {
    const passages = retrievePassages(chapters, 0, 'merchant dates figs caravan desert stars');
    const total = passages.reduce((n, p) => n + p.text.length, 0);
    expect(total).toBeLessThanOrEqual(BOOK_CHAT_CONTEXT_CHARS);
  });

  test('chapterTitleFor falls back to Chapter N without a TOC', () => {
    expect(chapterTitleFor(undefined, 4)).toBe('Chapter 5');
    expect(chapterTitleFor([{ id: 0, label: 'Prologue' }], 3)).toBe('Prologue');
  });

  test('flattenToc walks nested entries in document order', () => {
    const flat = flattenToc([
      { id: 0, label: 'One', subitems: [{ id: 1, label: 'One A' }] },
      { id: 2, label: 'Two' },
    ]);
    expect(flat.map((e) => e.label)).toEqual(['One', 'One A', 'Two']);
  });
});
