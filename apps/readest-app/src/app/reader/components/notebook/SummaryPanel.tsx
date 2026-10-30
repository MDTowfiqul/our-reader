'use client';

import React, { useCallback, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { hasAnyAIKey } from '@/services/ai/customProviders';
import { extractTextFromDocument } from '@/services/ai/utils/chunker';
import {
  SUMMARY_DISCLAIMER,
  summarizeBookFromChapters,
  summarizeSoFar,
  summarizeText,
  type SummaryKind,
  type SummaryLanguage,
  type SummaryPassage,
} from '@/services/ai/summaryService';
import { Button } from '@/components/ui/button';
import { Loader2Icon } from 'lucide-react';

interface SummaryPanelProps {
  bookKey: string;
}

type SectionLike = {
  createDocument: () => Promise<Document>;
};

function chapterTitleFor(
  toc: { id: number; label: string }[] | undefined,
  sectionIndex: number,
): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

const SummaryPanel: React.FC<SummaryPanelProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);

  const [language, setLanguage] = useState<SummaryLanguage>('book');
  const [kind, setKind] = useState<SummaryKind>('chapter');
  // Chapter picker: defaults to the chapter being read; the user can pick
  // any other chapter from the book's index instead.
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
      const base = { bookHash, bookTitle, authorName, language };
      if (kind === 'selection') {
        const selected = window.getSelection()?.toString().trim() || '';
        if (!selected) {
          setError(_('Select text in the book first, then open this tab again.'));
          return;
        }
        setSummary(await summarizeText({ ...base, kind, text: selected }, aiSettings));
        return;
      }
      if (kind === 'so-far') {
        const currentPage = progress?.pageinfo?.current ?? 0;
        const currentSection = progress?.section?.current ?? 0;
        const passages: SummaryPassage[] = [];
        const toc = (bookData?.bookDoc?.toc || []) as { id: number; label: string }[];
        for (let i = 0; i <= currentSection; i++) {
          const text = await getSectionText(i);
          if (text) {
            passages.push({
              chapterTitle: chapterTitleFor(toc, i),
              // Page numbers per section are unknown without layout; use the
              // current page for the last section and 0 (always allowed)
              // for earlier ones, so the spoiler filter never drops them.
              page: i === currentSection ? currentPage : 0,
              text,
            });
          }
        }
        setSummary(await summarizeSoFar({ ...base, kind, passages, currentPage }, aiSettings));
        return;
      }
      if (kind === 'chapter') {
        const sectionIndex = pickedChapter ?? progress?.section?.current ?? 0;
        const toc = (bookData?.bookDoc?.toc || []) as { id: number; label: string }[];
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
              chapterTitle: chapterTitleFor(toc, sectionIndex),
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
      const toc = (bookData?.bookDoc?.toc || []) as { id: number; label: string }[];
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
              chapterTitle: chapterTitleFor(toc, i),
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
    language,
    bookHash,
    bookTitle,
    authorName,
    progress,
    bookData?.bookDoc,
    getSectionText,
    pickedChapter,
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
            ['so-far', _('What happened so far')],
            ['selection', _('Selected passage')],
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
      <label className='flex items-center gap-2 text-xs'>
        <span>{_('Language')}</span>
        <select
          className='select select-sm select-bordered'
          value={language}
          onChange={(e) => setLanguage(e.target.value as SummaryLanguage)}
        >
          <option value='book'>{_("Book's language")}</option>
          <option value='bn'>{'Bengali'}</option>
          <option value='en'>{'English'}</option>
        </select>
      </label>
      {kind === 'chapter' && (
        <label className='flex items-center gap-2 text-xs'>
          <span>{_('Chapter')}</span>
          <select
            className='select select-sm select-bordered flex-1'
            value={pickedChapter ?? progress?.section?.current ?? 0}
            onChange={(e) => setPickedChapter(Number(e.target.value))}
          >
            {((bookData?.bookDoc?.sections || []) as unknown[]).map((_, i) => {
              const toc = (bookData?.bookDoc?.toc || []) as {
                id: number;
                label: string;
              }[];
              return (
                <option key={i} value={i}>
                  {chapterTitleFor(toc, i)}
                </option>
              );
            })}
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
