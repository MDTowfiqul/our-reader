'use client';

import React, { useCallback, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { extractTextFromDocument } from '@/services/ai/utils/chunker';
import { SUMMARY_DISCLAIMER } from '@/services/ai/summaryService';
import { chatWithAI, hasAnyAIKey } from '@/services/ai/customProviders';
import { Button } from '@/components/ui/button';
import { Loader2Icon } from 'lucide-react';

/**
 * Chat with the book (Notebook → AI tab, when a custom provider key is
 * set). The AI answers AS the book itself, grounded only in the current
 * chapter's text: anything not in the book gets a plain "not in the book"
 * answer instead of an invented one. The user's custom instruction from
 * Settings → AI, when set, is prepended by the shared chat route.
 */

interface BookChatProps {
  bookKey: string;
}

type SectionLike = {
  createDocument: () => Promise<Document>;
};

type ChatTurn = { role: 'user' | 'assistant'; content: string };

const CHAPTER_CHARS = 20000;

const BookChat: React.FC<BookChatProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const aiSettings = settings?.aiSettings;
  const hasKey = !!aiSettings && hasAnyAIKey(aiSettings);

  const getChapterText = useCallback(async (): Promise<string> => {
    const sections = (bookData?.bookDoc?.sections || []) as unknown as SectionLike[];
    const sectionIndex = progress?.section?.current ?? 0;
    const section = sections[sectionIndex];
    if (!section) return '';
    const doc = await section.createDocument();
    return extractTextFromDocument(doc);
  }, [bookData?.bookDoc, progress?.section?.current]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || !aiSettings || isLoading) return;
    setInput('');
    setError('');
    setIsLoading(true);
    const nextMessages: ChatTurn[] = [...messages, { role: 'user' as const, content: question }];
    setMessages(nextMessages);
    try {
      const chapterText = (await getChapterText()).slice(0, CHAPTER_CHARS);
      if (!chapterText) {
        setError(_('Could not read the current chapter.'));
        setMessages(messages);
        return;
      }
      const system =
        `You ARE the book "${bookTitle}"${authorName ? ` by ${authorName}` : ''}. ` +
        'Answer the reader as the book itself, using ONLY the chapter text below. ' +
        'If the answer is not in the book, say plainly that it is not in the book — ' +
        'never invent details, and never use outside knowledge of the book. ' +
        `Chapter text:\n\n${chapterText}`;
      const reply = await chatWithAI(aiSettings, system, nextMessages);
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError((e as Error).message || _('Chat failed.'));
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  }, [input, aiSettings, isLoading, messages, getChapterText, bookTitle, authorName, _]);

  if (!hasKey) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <p className='text-foreground text-sm font-medium'>{_('AI chat needs a key')}</p>
        <p className='text-muted-foreground text-xs'>
          {_('Add an API key in Settings → AI, then come back here.')}
        </p>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col gap-3 overflow-y-auto p-4'>
      <p className='text-muted-foreground text-xs'>
        {_('Chatting with this book — answers come from the current chapter only.')}
      </p>
      <div className='flex flex-1 flex-col gap-3'>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'not-eink:bg-base-200 eink-bordered self-end max-w-[85%]'
                : 'self-start w-full'
            }`}
          >
            <p className='whitespace-pre-wrap'>{m.content}</p>
          </div>
        ))}
        {isLoading && (
          <p className='text-muted-foreground flex items-center gap-2 text-xs'>
            <Loader2Icon className='size-3.5 animate-spin' />
            {_('Thinking…')}
          </p>
        )}
      </div>
      {messages.length > 0 && (
        <p className='text-muted-foreground text-xs italic'>{SUMMARY_DISCLAIMER}</p>
      )}
      {error && <p className='text-error text-xs'>{error}</p>}
      <div className='flex gap-2'>
        <input
          type='text'
          className='input input-sm eink-bordered flex-1'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSend();
          }}
          placeholder={_('Ask the book anything…')}
        />
        <Button onClick={() => void handleSend()} disabled={isLoading || !input.trim()} size='sm'>
          {_('Send')}
        </Button>
      </div>
    </div>
  );
};

export default BookChat;
