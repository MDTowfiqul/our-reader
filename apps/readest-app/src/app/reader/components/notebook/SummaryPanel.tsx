'use client';

import React, { useCallback, useMemo, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { hasAnyAIKey } from '@/services/ai/customProviders';
import { chapterTitleFor, flattenToc } from '@/services/ai/bookRetrieval';
import { extractTextFromDocument } from '@/services/ai/utils/chunker';
import {
  SUMMARY_DISCLAIMER,
  summarizeBookFromChapters,
  summarizeText,
  type SummaryKind,
} from '@/services/ai/summaryService';
import { Button } from '@/components/ui/button';
import { Loader2Icon } from 'lucide-react';

interface SummaryPanelProps {
  bookKey: string;
}

type SectionLike = {
  createDocument: () => Promise<Document>;
};

type TocLike = { id: number; label: string; subitems?: TocLike[] };

/**
 * AI summaries: exactly two modes — this chapter, or the whole book.
 * No language option: summaries are written in the book's own language
 * (the service's 'book' language, i.e. "answer in the same language as
 * the passage"). Selection summarising lives on the reading page's
 * selection popup instead, and "what happened so far" is gone.
 */
const SummaryPanel: React.FC<SummaryPanelProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);

  const [kind, setKind] = useState<SummaryKind>('chapter');
  // Chapter picker: defaults to the chapter being read; the user can pick
  // any chapter from the book's index instead.
  const [pickedChapter, setPickedChapter] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState('');

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const aiSettings = settings?.aiSettings;
  const hasKey = !!aiSettings && hasAnyAIKey(aiSettings);

  const toc = useMemo(
    () => flattenToc((bookData?.bookDoc?.toc || []) as TocLike[]),
    [bookData?.bookDoc],
  );
  const sectionCount = (bookData?.bookDoc?.sections || []).length;
  const currentSection = progress?.section?.current ?? 0;
  // Picker entries: real index titles when the book has a TOC, otherwise
  // one "Chapter N" entry per section. A TOC entry summarises its section.
  const pickerEntries = useMemo(() => {
    if (toc.length > 0) return toc.map((entry) => ({ value: entry.id, label: entry.label }));
    return Array.from({ length: sectionCount }, (_, i) => ({
      value: i,
      label: `Chapter ${i + 1}`,
    }));
  }, [toc, sectionCount]);
  // Default picker value: the TOC entry at or before the chapter being
  // read (the section's own title), else the first entry.
  const defaultPicked = useMemo(() => {
    if (pickerEntries.length === 0) return 0;
    let best = pickerEntries[0]!.value;
    for (const entry of pickerEntries) {
      if (entry.value <= currentSection) best = entry.value;
      else break;
    }
    return best;
  }, [pickerEntries, currentSection]);

  const getSectionText = useCallback(
    async (sectionIndex: number): Promise<string> => {
      const sections = (bookData?.bookDoc?.sections || []) as unknown as SectionLike[];
      const section = sections[sectionIndex];
      if (!section) return '';
      const doc = await section.createDocument();
      return extractTextFromDocument(doc);
    },
    [bookData?.bookDoc],
  );

  const handleSummarize = useCallback(async () => {
    if (!aiSettings || !hasKey) return;
    setIsLoading(true);
    setError('');
    setSummary('');
    setProgressText('');
    try {
      // 'book' language = the book's own language, always.
      const base = { bookHash, bookTitle, authorName, language: 'book' as const };
      if (kind === 'chapter') {
        const sectionIndex = pickedChapter ?? defaultPicked;
        const rawToc = (bookData?.bookDoc?.toc || []) as TocLike[];
        const text = await getSectionText(sectionIndex);
        if (!text) {
          setError(_('Could not read the current chapter.'));
          return;
        }
        setSummary(
          await summarizeText(
            {
              ...base,
              kind,
              chapterTitle: chapterTitleFor(rawToc, sectionIndex),
              sectionIndex,
              text,
            },
            aiSettings,
          ),
        );
        return;
      }
      // Whole book: one chapter summary per section (cached), then reduce.
      const sections = (bookData?.bookDoc?.sections || []) as unknown as SectionLike[];
      const rawToc = (bookData?.bookDoc?.toc || []) as TocLike[];
      const chapterSummaries: string[] = [];
      for (let i = 0; i < sections.length; i++) {
        setProgressText(
          _('Summarising chapter {{current}} of {{total}}…', {
            current: i + 1,
            total: sections.length,
          }),
        );
        const text = await getSectionText(i);
        if (!text) continue;
        chapterSummaries.push(
          await summarizeText(
            {
              ...base,
              kind: 'chapter',
              chapterTitle: chapterTitleFor(rawToc, i),
              sectionIndex: i,
              text,
            },
            aiSettings,
          ),
        );
      }
      setProgressText('');
      setSummary(await summarizeBookFromChapters({ ...base, kind }, chapterSummaries, aiSettings));
    } catch (e) {
      setError((e as Error).message || _('Summarising failed.'));
    } finally {
      setIsLoading(false);
    }
  }, [
    aiSettings,
    hasKey,
    kind,
    bookHash,
    bookTitle,
    authorName,
    bookData?.bookDoc,
    getSectionText,
    pickedChapter,
    defaultPicked,
    _,
  ]);

  if (!hasKey) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <p className='text-foreground text-sm font-medium'>{_('AI summaries need a key')}</p>
        <p className='text-muted-foreground text-xs'>
          {_('Add an API key in Settings → AI, then come back here.')}
        </p>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col gap-3 overflow-y-auto p-4'>
      <div className='flex flex-wrap gap-2'>
        {(
          [
            ['chapter', _('This chapter')],
            ['book', _('Whole book')],
          ] as [SummaryKind, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type='button'
            onClick={() => setKind(value)}
            className={`btn btn-sm ${kind === value ? 'btn-contrast' : 'btn-ghost eink-bordered'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'chapter' && pickerEntries.length > 0 && (
        <label className='flex items-center gap-2 text-xs'>
          <span>{_('Chapter')}</span>
          <select
            className='select select-sm select-bordered flex-1'
            value={pickedChapter ?? defaultPicked}
            onChange={(e) => setPickedChapter(Number(e.target.value))}
          >
            {pickerEntries.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button onClick={handleSummarize} disabled={isLoading} size='sm' className='h-8 text-xs'>
        {isLoading && <Loader2Icon className='mr-1.5 size-3.5 animate-spin' />}
        {isLoading ? progressText || _('Summarising…') : _('Summarise')}
      </Button>
      {error && <p className='text-error text-xs'>{error}</p>}
      {summary && (
        <div className='flex flex-col gap-2'>
          <p className='text-muted-foreground text-xs italic'>{SUMMARY_DISCLAIMER}</p>
          <p className='whitespace-pre-wrap text-sm leading-relaxed'>{summary}</p>
        </div>
      )}
    </div>
  );
};

export default SummaryPanel;
