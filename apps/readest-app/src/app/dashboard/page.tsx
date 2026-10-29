'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  getDailySeconds,
  getStreaks,
  toDateKey,
} from '@/services/statistics/readingStats';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import ReadingTimeChart from '@/components/stats/ReadingTimeChart';
import ReadingHeatmap from '@/components/stats/ReadingHeatmap';

interface DashboardRow {
  book: Book;
  seconds: number;
  pages: number;
  lastOpen: number;
}

function sumInRange(daily: Map<string, number>, from: Date, to: Date): number {
  let total = 0;
  for (const [key, seconds] of daily) {
    const day = new Date(`${key}T00:00:00`);
    if (day >= from && day <= to) total += seconds;
  }
  return total;
}

/**
 * Reader status dashboard (Our Reader Stage 2a): per-book status, progress,
 * pages and time; today/week/month/year totals; streak + heatmap; currently
 * reading and recently finished. No goals in this pass. Data comes from the
 * library plus the local reading-statistics database; a missing or empty
 * statistics database simply shows zeros, never an error page.
 */
const DashboardPage: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryBooks = useLibraryStore((s) => s.visibleLibrary);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [daily, setDaily] = useState<Map<string, number>>(new Map());
  const [totals, setTotals] = useState({ seconds: 0, books: 0, pages: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    const load = async () => {
      try {
        const books =
          libraryBooks.length > 0 ? libraryBooks : await appService.loadLibraryBooks();
        const db = await StatisticsDb.open(appService);
        const [quarters, allTotals] = await Promise.all([
          db.getQuarterHourDurations(),
          db.getReadingTotals(),
        ]);
        const loaded: DashboardRow[] = [];
        for (const book of books.filter((b) => !b.deletedAt)) {
          try {
            const stat = await db.getBookByMd5(book.hash);
            loaded.push({
              book,
              seconds: stat?.total_read_time ?? 0,
              pages: stat?.total_read_pages ?? 0,
              lastOpen: stat?.last_open ?? 0,
            });
          } catch {
            loaded.push({ book, seconds: 0, pages: 0, lastOpen: 0 });
          }
        }
        if (cancelled) return;
        setDaily(getDailySeconds(quarters));
        setTotals(allTotals);
        setRows(loaded);
      } catch (err) {
        console.warn('Failed to load dashboard:', err);
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [appService, libraryBooks]);

  const streaks = useMemo(() => getStreaks(daily), [daily]);
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - 6);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const finished = useMemo(
    () => rows.filter((r) => r.book.readingStatus === 'finished'),
    [rows],
  );
  const currentlyReading = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.book.readingStatus === 'reading' ||
          (r.book.progress != null && r.book.readingStatus !== 'finished'),
      ),
    [rows],
  );
  const recentlyFinished = useMemo(
    () =>
      [...finished]
        .sort((a, b) => b.book.updatedAt - a.book.updatedAt)
        .slice(0, 10),
    [finished],
  );
  const tableRows = useMemo(
    () => [...rows].sort((a, b) => b.lastOpen - a.lastOpen),
    [rows],
  );

  return (
    <main className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
      <div className='flex items-baseline justify-between gap-4'>
        <h1 className='text-xl font-bold'>{_('Reader Dashboard')}</h1>
        <a href='/library' className='link text-sm'>
          {_('Back to Library')}
        </a>
      </div>

      {failed && (
        <p className='text-base-content/70 py-6 text-center'>
          {_('Failed to load reading statistics')}
        </p>
      )}

      <BoxedList title={_('Reading Time')} innerClassName='pe-4 py-4'>
        <ReadingTimeChart daily={daily} />
      </BoxedList>
      <BoxedList title={_('Activity')} innerClassName='pe-4 py-4'>
        <ReadingHeatmap daily={daily} />
      </BoxedList>

      <BoxedList title={_('Overview')}>
        <SettingsRow label={_('Today')}>
          <span className='tabular-nums'>{time(daily.get(toDateKey(today)) ?? 0)}</span>
        </SettingsRow>
        <SettingsRow label={_('This week')}>
          <span className='tabular-nums'>{time(sumInRange(daily, startOfWeek, today))}</span>
        </SettingsRow>
        <SettingsRow label={_('This month')}>
          <span className='tabular-nums'>{time(sumInRange(daily, startOfMonth, today))}</span>
        </SettingsRow>
        <SettingsRow label={_('This year')}>
          <span className='tabular-nums'>{time(sumInRange(daily, startOfYear, today))}</span>
        </SettingsRow>
        <SettingsRow label={_('Current Streak')}>
          <span className='tabular-nums'>{_('{{count}} days', { count: streaks.current })}</span>
        </SettingsRow>
        <SettingsRow label={_('Longest Streak')}>
          <span className='tabular-nums'>{_('{{count}} days', { count: streaks.longest })}</span>
        </SettingsRow>
        <SettingsRow label={_('Books finished')}>
          <span className='tabular-nums'>{finished.length.toLocaleString(getLocale())}</span>
        </SettingsRow>
        <SettingsRow label={_('Total reading time')}>
          <span className='tabular-nums'>{time(totals.seconds)}</span>
        </SettingsRow>
        <SettingsRow label={_('Total pages read')}>
          <span className='tabular-nums'>{totals.pages.toLocaleString(getLocale())}</span>
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Currently reading')}>
        {currentlyReading.length === 0 ? (
          <p className='text-base-content/70 px-4 py-3 text-sm'>{_('Nothing in progress')}</p>
        ) : (
          currentlyReading.map(({ book }) => (
            <SettingsRow key={book.hash} label={book.title}>
              <span className='tabular-nums'>
                {book.progress && book.progress[1] > 0
                  ? `${Math.round((book.progress[0] / book.progress[1]) * 100)}%`
                  : '—'}
              </span>
            </SettingsRow>
          ))
        )}
      </BoxedList>

      <BoxedList title={_('Recently finished')}>
        {recentlyFinished.length === 0 ? (
          <p className='text-base-content/70 px-4 py-3 text-sm'>{_('No finished books yet')}</p>
        ) : (
          recentlyFinished.map(({ book }) => (
            <SettingsRow key={book.hash} label={book.title}>
              <span className='tabular-nums'>
                {book.rating ? `${book.rating} / 10` : _('Unrated')}
              </span>
            </SettingsRow>
          ))
        )}
      </BoxedList>

      <BoxedList title={_('All books')}>
        <div className='overflow-x-auto px-4 py-2'>
          <table className='table table-sm w-full'>
            <thead>
              <tr>
                <th>{_('Book')}</th>
                <th>{_('Status')}</th>
                <th className='text-right'>{_('Progress')}</th>
                <th className='text-right'>{_('Pages')}</th>
                <th className='text-right'>{_('Time')}</th>
                <th className='text-right'>{_('Rating')}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ book, seconds, pages }) => (
                <tr key={book.hash}>
                  <td className='max-w-55 truncate'>{book.title}</td>
                  <td>{book.readingStatus || _('Unread')}</td>
                  <td className='text-right tabular-nums'>
                    {book.progress && book.progress[1] > 0
                      ? `${Math.round((book.progress[0] / book.progress[1]) * 100)}%`
                      : '—'}
                  </td>
                  <td className='text-right tabular-nums'>{pages.toLocaleString(getLocale())}</td>
                  <td className='text-right tabular-nums'>{time(seconds)}</td>
                  <td className='text-right tabular-nums'>
                    {book.rating ? `${book.rating} / 10` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableRows.length === 0 && (
            <p className='text-base-content/70 py-3 text-center text-sm'>
              {_('No books in the library yet')}
            </p>
          )}
        </div>
      </BoxedList>
    </main>
  );
};

export default DashboardPage;
