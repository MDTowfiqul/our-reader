import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToReader } from '@/utils/nav';
import Dialog from '@/components/Dialog';
import {
  BOIGHAR_BASE_URL,
  fetchBoigharIndex,
  resolveBoigharEpubUrl,
  searchBoigharBooks,
  type BoigharBook,
} from '@/services/boighar';

const MAX_RESULTS = 50;

/**
 * Our Boighar, inside the app.
 *
 * With no search typed, the Boighar website itself fills the dialog (iframe).
 * Typing searches the site's book index instead: tapping a book resolves its
 * EPUB download link and imports it into the library, then opens the reader
 * — the same import path as opening a `?url=` link.
 */
export const BoigharBrowser = ({ onClose }: { onClose: () => void }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { library, setLibrary } = useLibraryStore();
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<BoigharBook[]>([]);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [importingTitle, setImportingTitle] = useState<string | null>(null);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchBoigharIndex().then((index) => {
      if (cancelled) return;
      setBooks(index);
      setIndexLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(
    () => (query.trim() ? searchBoigharBooks(books, query).slice(0, MAX_RESULTS) : []),
    [books, query],
  );

  const handleOpenBook = async (book: BoigharBook) => {
    if (!appService || importingTitle) return;
    setImportingTitle(book.title);
    setImportError('');
    try {
      const epubUrl = await resolveBoigharEpubUrl(book.pageUrl);
      const imported = await appService.importBook(epubUrl, library);
      if (!imported) throw new Error('import returned null');
      setLibrary(library);
      appService.saveLibraryBooks(library);
      onClose();
      navigateToReader(router, [imported.hash]);
    } catch (error) {
      console.error('Failed to open book from Our Boighar:', error);
      setImportError(_('Could not open this book in Our Reader. Please try again.'));
    } finally {
      setImportingTitle(null);
    }
  };

  return (
    <Dialog
      isOpen={true}
      title={_('Our Boighar')}
      onClose={onClose}
      fullScreen
      boxClassName='sm:max-w-3xl!'
    >
      <div className='flex h-full flex-col gap-2'>
        <input
          type='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={_('Search Our Boighar books…')}
          aria-label={_('Search Our Boighar books')}
          className='input input-bordered w-full shrink-0'
        />
        {importError && <p className='text-error shrink-0 text-sm'>{importError}</p>}
        {query.trim() ? (
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {!indexLoaded ? (
              <div className='flex h-40 flex-col gap-4'>
                <div className='skeleton h-4 w-full'></div>
                <div className='skeleton h-4 w-full'></div>
                <div className='skeleton h-4 w-full'></div>
              </div>
            ) : books.length === 0 ? (
              <p className='text-base-content/60 px-2 py-8 text-center text-sm'>
                {_(
                  'Could not load the Our Boighar book list. Check your connection and try again.',
                )}
              </p>
            ) : results.length === 0 ? (
              <p className='text-base-content/60 px-2 py-8 text-center text-sm'>
                {_('No books found for "{{query}}"', { query: query.trim() })}
              </p>
            ) : (
              <ul className='divide-base-200 divide-y'>
                {results.map((book) => (
                  <li key={book.pageUrl}>
                    <button
                      onClick={() => handleOpenBook(book)}
                      disabled={importingTitle !== null}
                      className='hover:bg-base-200 flex w-full items-center gap-3 px-2 py-2 text-start transition-colors disabled:opacity-60'
                    >
                      {book.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={book.cover}
                          alt=''
                          loading='lazy'
                          className='h-16 w-11 shrink-0 rounded object-cover'
                        />
                      ) : (
                        <span className='bg-base-200 h-16 w-11 shrink-0 rounded' />
                      )}
                      <span className='flex min-w-0 flex-col gap-0.5'>
                        <span className='line-clamp-2 text-sm font-medium leading-snug'>
                          {book.title}
                        </span>
                        {book.author && (
                          <span className='text-base-content/60 truncate text-xs'>
                            {book.author}
                          </span>
                        )}
                        {importingTitle === book.title && (
                          <span className='text-xs font-bold'>{_('Opening…')}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <iframe
            src={`${BOIGHAR_BASE_URL}/`}
            title={_('Our Boighar')}
            className='min-h-0 w-full flex-1 border-0'
          />
        )}
      </div>
    </Dialog>
  );
};
