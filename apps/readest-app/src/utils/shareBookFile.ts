import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { EXTS, MIMETYPES } from '@/libs/document';
import { getLocalBookFilename } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { makeSafeFilename } from '@/utils/misc';

/**
 * "Share Book" hands the actual book file to the OS share sheet
 * (Intent.ACTION_SEND on Android, UIActivityViewController on iOS,
 * NSSharingServicePicker on macOS) — no account, no link, no cloud.
 * This is the same file-send the library's multi-select "Send" uses;
 * the old remote-link share (ShareBookDialog) needed a sign-in and is
 * no longer wired to the menu.
 *
 * Returns true when the share sheet opened. When the book file is not
 * on the device, or the share fails, a toast explains why.
 */
export async function shareBookFile(
  appService: AppService | null,
  book: Book,
  _: (value: string) => string,
  sharePosition?: {
    x: number;
    y: number;
    preferredEdge?: 'top' | 'bottom' | 'left' | 'right';
  },
): Promise<boolean> {
  if (!appService) return false;
  try {
    // Resolve the file the same way bookContent.resolveBookContentSource
    // does, but via the public AppService surface (the underlying `fs`
    // is protected): managed copy under Books/<hash>/ first, then the
    // device-local in-place import path. Cloud-only books or remote
    // URL books can't be shared without first downloading them.
    const managedPath = getLocalBookFilename(book);
    let path: string;
    let base: 'Books' | 'None';
    if (await appService.exists(managedPath, 'Books')) {
      path = managedPath;
      base = 'Books';
    } else if (book.filePath && (await appService.exists(book.filePath, 'None'))) {
      path = book.filePath;
      base = 'None';
    } else {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Book file is not available locally'),
        timeout: 2500,
      });
      return false;
    }
    const ext = EXTS[book.format] ?? 'bin';
    const mimeType = MIMETYPES[book.format]?.[0] ?? 'application/octet-stream';
    const baseName = makeSafeFilename(book.sourceTitle || book.title || book.hash);
    const shareFilename = `${baseName}.${ext}`;

    // Native (Tauri) only — the Share button is hidden on web because
    // browsers can't surface a real "share to <app>" sheet for an
    // arbitrary local file. Hand the already-on-disk file straight to
    // the OS share sheet via `options.filePath`. Without it,
    // saveFile() falls back to writing a temp copy under
    // BaseDirectory.Temp, which on Android resolves to
    // /data/local/tmp/ — the app sandbox has no write permission
    // there and the call fails with EACCES. Passing the absolute path
    // also avoids re-buffering the whole epub/pdf into memory just to
    // have saveFile write it back to disk.
    const absoluteFilePath = await appService.resolveFilePath(path, base);
    // `null` content: there's nothing to write — the file already lives at
    // `filePath`, which the native share path reads directly.
    await appService.saveFile(shareFilename, null, {
      share: true,
      mimeType,
      filePath: absoluteFilePath,
      sharePosition,
    });
    return true;
  } catch (err) {
    console.error('Failed to send book file:', err);
    eventDispatcher.dispatch('toast', {
      type: 'error',
      message: _('Failed to send book'),
      timeout: 2500,
    });
    return false;
  }
}
