import React, { useEffect, useState } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { hasAnyAIKey } from '@/services/ai/customProviders';
import { SUMMARY_DISCLAIMER, summarizeText } from '@/services/ai/summaryService';

/**
 * Selection summary popup (reading page). Opened from the selection
 * toolbar's Summarise action; it summarises exactly the selected text
 * via the active AI provider and shows the result here, next to the
 * translate/dictionary popups' pattern. Summaries are written in the
 * book's own language, and always carry the summary disclaimer.
 */

interface SummaryPopupProps {
  bookKey: string;
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const SummaryPopup: React.FC<SummaryPopupProps> = ({
  bookKey,
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiSettings = settings?.aiSettings;
  const hasKey = !!aiSettings && hasAnyAIKey(aiSettings);

  useEffect(() => {
    if (!aiSettings || !hasKey) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    summarizeText(
      {
        bookHash: bookKey.split('-')[0] || '',
        bookTitle: bookData?.book?.title || 'Unknown',
        authorName: bookData?.book?.author || '',
        language: 'book',
        kind: 'selection',
        text,
      },
      aiSettings,
    )
      .then((result) => setSummary(result))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={720}
        position={position}
        className='grid h-full select-text grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]'
        onDismiss={onDismiss}
      >
        <div className='overflow-y-auto p-4 font-sans'>
          <h1 className='mb-2 text-sm font-medium'>{_('Selected Text')}</h1>
          <p className='text-base'>{text}</p>
        </div>
        <div className='mx-4 shrink-0 border-t border-base-content/20'></div>
        <div className='overflow-y-auto p-4 font-sans'>
          <h2 className='mb-2 text-sm font-medium'>{_('Summary')}</h2>
          {!hasKey ? (
            <p className='text-base text-base-content/80'>
              {_('AI summaries need a key. Add an API key in Settings → AI, then try again.')}
            </p>
          ) : loading ? (
            <p className='text-base-content/80 italic'>{_('Summarising…')}</p>
          ) : error ? (
            <div>
              <p className='text-base text-red-600'>{_('Summarising failed. Try again later.')}</p>
              <p className='mt-1 break-words text-xs text-base-content/60'>{error}</p>
            </div>
          ) : (
            <p className='text-base'>{summary || _('No summary available.')}</p>
          )}
        </div>
        <div className='flex shrink-0 items-center justify-between gap-2 rounded-b-lg px-4 py-2'>
          <p className='text-muted-foreground text-xs italic'>{SUMMARY_DISCLAIMER}</p>
        </div>
      </Popup>
    </div>
  );
};

export default SummaryPopup;
