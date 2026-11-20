import { describe, expect, it, vi, beforeEach } from 'vitest';
import { shareBookFile } from '@/utils/shareBookFile';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'My Book',
  sourceTitle: 'My Book',
} as unknown as Book;

const makeAppService = () =>
  ({
    exists: vi.fn(),
    resolveFilePath: vi.fn(async (path: string) => `/resolved/${path}`),
    saveFile: vi.fn(async () => true),
  }) as unknown as AppService;

describe('shareBookFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(eventDispatcher, 'dispatch').mockImplementation(async () => {});
  });

  it('shares the managed copy through the OS share sheet', async () => {
    const appService = makeAppService();
    vi.mocked(appService.exists).mockResolvedValue(true);
    const ok = await shareBookFile(appService, book, (v) => v);
    expect(ok).toBe(true);
    expect(appService.saveFile).toHaveBeenCalledWith('My Book.epub', null, {
      share: true,
      mimeType: 'application/epub+zip',
      filePath: '/resolved/h1/My Book.epub',
      sharePosition: undefined,
    });
  });

  it('falls back to the in-place import path when there is no managed copy', async () => {
    const appService = makeAppService();
    const localBook = { ...book, filePath: '/device/My Book.epub' } as unknown as Book;
    vi.mocked(appService.exists).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const ok = await shareBookFile(appService, localBook, (v) => v);
    expect(ok).toBe(true);
    expect(appService.resolveFilePath).toHaveBeenCalledWith('/device/My Book.epub', 'None');
  });

  it('warns when the book file is not on the device', async () => {
    const appService = makeAppService();
    vi.mocked(appService.exists).mockResolvedValue(false);
    const ok = await shareBookFile(appService, book, (v) => v);
    expect(ok).toBe(false);
    expect(appService.saveFile).not.toHaveBeenCalled();
    expect(eventDispatcher.dispatch).toHaveBeenCalledWith('toast', {
      type: 'warning',
      message: 'Book file is not available locally',
      timeout: 2500,
    });
  });

  it('reports a failed share instead of throwing', async () => {
    const appService = makeAppService();
    vi.mocked(appService.exists).mockResolvedValue(true);
    vi.mocked(appService.saveFile).mockRejectedValue(new Error('share failed'));
    const ok = await shareBookFile(appService, book, (v) => v);
    expect(ok).toBe(false);
    expect(eventDispatcher.dispatch).toHaveBeenCalledWith('toast', {
      type: 'error',
      message: 'Failed to send book',
      timeout: 2500,
    });
  });

  it('does nothing without an app service', async () => {
    const ok = await shareBookFile(null, book, (v) => v);
    expect(ok).toBe(false);
    expect(eventDispatcher.dispatch).not.toHaveBeenCalled();
  });
});
