import clsx from 'clsx';
import semver from 'semver';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useEffect, useState } from 'react';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { useSearchParams } from 'next/navigation';
import { getAppVersion, isUpdateNewer } from '@/utils/version';
import { tauriDownload } from '@/utils/transfer';
import { installPackage } from '@/utils/bridge';
import { getLocale } from '@/utils/misc';
import { fetchOurLatestRelease, setLastShownReleaseNotesVersion } from '@/helpers/updater';
import { OUR_READER_RELEASES_URL } from '@/services/constants';
import Dialog from '@/components/Dialog';
import Link from './Link';

interface Changelog {
  version: string;
  date: string;
  notes: string[];
  // Auto-translated notes, kept alongside the original English `notes` so the
  // reader can flip back to the source text. Only set when translation ran.
  translatedNotes?: string[];
}

type DownloadEvent =
  | {
      event: 'Started';
      data: {
        contentLength?: number;
      };
    }
  | {
      event: 'Progress';
      data: {
        chunkLength: number;
      };
    }
  | {
      event: 'Finished';
    };

interface GenericUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  /** Desktop only: there is no installable artifact yet, so the action just
      opens OUR GitHub release page in the browser. */
  openReleasePage?: boolean;
  downloadAndInstall?(onEvent?: (progress: DownloadEvent) => void): Promise<void>;
}

/** Turn a GitHub release body into changelog lines. */
const parseReleaseNotesBody = (input: string): string[] => {
  return input
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, ''),
    )
    .filter((line) => line.length > 0);
};

export const UpdaterContent = ({
  latestVersion,
  lastVersion,
  checkUpdate = true,
}: {
  latestVersion?: string;
  lastVersion?: string;
  checkUpdate?: boolean;
}) => {
  const _ = useTranslation();
  const [targetLang, setTargetLang] = useState('EN');
  const { translate } = useTranslator({
    provider: 'azure',
    sourceLang: 'AUTO',
    targetLang,
  });
  const { appService } = useEnv();
  const searchParams = useSearchParams();
  const currentVersion = getAppVersion();
  const [newVersion, setNewVersion] = useState(
    latestVersion ?? searchParams?.get('latestVersion') ?? '',
  );
  const [oldVersion, setOldVersion] = useState(
    lastVersion ?? searchParams?.get('lastVersion') ?? '',
  );
  const [update, setUpdate] = useState<GenericUpdate | null>(null);
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetLang(getLocale());
  }, []);

  useEffect(() => {
    // Android: download OUR release APK asset from OUR GitHub release and
    // install it. A single universal arm64 APK is attached to the release,
    // so there is no per-ABI manifest to consult.
    const checkAndroidUpdate = async () => {
      if (!appService) return;
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const release = await fetchOurLatestRelease(fetch as unknown as typeof tauriFetch);
      if (!release || !isUpdateNewer(release.version, currentVersion) || !release.apkUrl) {
        return;
      }
      const downloadUrl = release.apkUrl;
      const apkFilePath = await appService.resolveFilePath(
        `OurReader_${release.version}_arm64.apk`,
        'Cache',
      );
      setUpdate({
        currentVersion,
        version: release.version,
        date: release.publishedAt,
        body: release.body,
        downloadAndInstall: async (onEvent) => {
          await new Promise<void>(async (resolve, reject) => {
            let downloaded = 0;
            let total = 0;
            await tauriDownload(downloadUrl, apkFilePath, (progress) => {
              if (!onEvent) return;
              if (!total && progress.total) {
                total = progress.total;
                onEvent({
                  event: 'Started',
                  data: { contentLength: total },
                });
              } else if (downloaded > 0 && progress.progress === progress.total) {
                console.log('APK downloaded to', apkFilePath);
                onEvent?.({ event: 'Finished' });
                setTimeout(() => {
                  resolve();
                }, 1000);
              }

              onEvent({
                event: 'Progress',
                data: { chunkLength: progress.progress - downloaded },
              });
              downloaded = progress.progress;
            }).catch((error) => {
              console.error('Download failed:', error);
              reject(error);
            });
          });

          const res = await installPackage({
            path: apkFilePath,
          });
          if (res.success) {
            console.log('APK installed successfully');
          } else {
            console.error('Failed to install APK:', res.error);
          }
        },
      } as GenericUpdate);
    };
    // Desktop: Our Reader ships no desktop updater artifacts yet. When OUR
    // latest release is newer, offer it and open the GitHub release page
    // for the download — never the upstream Readest updater.
    const checkDesktopUpdate = async () => {
      const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const release = await fetchOurLatestRelease(fetch as unknown as typeof tauriFetch);
      if (!release || !isUpdateNewer(release.version, currentVersion)) {
        return;
      }
      setUpdate({
        currentVersion,
        version: release.version,
        date: release.publishedAt,
        body: release.body,
        openReleasePage: true,
        downloadAndInstall: async () => {
          await openUrl(OUR_READER_RELEASES_URL);
        },
      } as GenericUpdate);
    };
    const checkForUpdates = async () => {
      const OS_TYPE = osType();
      try {
        if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
          await checkDesktopUpdate();
        } else if (OS_TYPE === 'android') {
          await checkAndroidUpdate();
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
        setError(_('Failed to check for updates'));
      }
    };
    if (appService?.hasUpdater && checkUpdate) {
      checkForUpdates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasUpdater]);

  useEffect(() => {
    if (latestVersion) {
      setNewVersion(latestVersion);
    }
    if (lastVersion) {
      setOldVersion(lastVersion);
    }
    if (!checkUpdate) {
      setUpdate({
        currentVersion,
        version: latestVersion,
        date: '',
        body: '',
      } as GenericUpdate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestVersion, lastVersion, checkUpdate]);

  useEffect(() => {
    const fetchChangelogs = async (fromVersion: string): Promise<Changelog[]> => {
      try {
        const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
        const release = await fetchOurLatestRelease(fetch as unknown as typeof tauriFetch);
        if (!release) return [];
        // Show OUR latest release's notes: when it is newer than what the
        // reader had (the update case) and when it is the installed version
        // (the What's New case), so the notes never come up empty.
        if (!semver.gt(release.version, fromVersion) && release.version !== currentVersion) {
          return [];
        }
        return [
          {
            version: release.version,
            date: release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : '',
            notes: parseReleaseNotesBody(release.body),
          },
        ];
      } catch (error) {
        console.error('Failed to fetch changelog:', error);
        return [];
      }
    };
    const updateChangelogs = async (update: GenericUpdate) => {
      setNewVersion(update.version);
      let changelogs = await fetchChangelogs(oldVersion || currentVersion);
      if (changelogs.length === 0 && update.date && update.body) {
        changelogs = [
          {
            version: update.version,
            date: new Date(update.date).toLocaleDateString(),
            notes: parseReleaseNotesBody(update.body ?? ''),
          },
        ];
      }
      if (!targetLang.toLowerCase().startsWith('en')) {
        for (const entry of changelogs) {
          try {
            // Preserve the original English `notes`; store the translation
            // separately so the "Show original" toggle can flip between them.
            entry.translatedNotes = await translate(entry.notes, { useCache: true });
          } catch (error) {
            console.log('Failed to translate changelog:', error);
          }
        }
      }

      setChangelogs(changelogs);
      setLastShownReleaseNotesVersion(newVersion);
    };
    if (update) {
      updateChangelogs(update);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleDownloadInstall = async () => {
    if (!update) {
      return;
    }
    // Desktop: no installable artifact — the action just opens OUR GitHub
    // release page. No progress bar, no relaunch.
    if (update.openReleasePage) {
      try {
        await update.downloadAndInstall?.();
      } catch (error) {
        console.error('Failed to open the release page:', error);
        setError(_('Failed to download and install update'));
      }
      return;
    }
    let downloaded = 0;
    let contentLength = 0;
    let lastLogged = 0;
    setProgress(0);
    setIsDownloading(true);
    try {
      await update.downloadAndInstall?.((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength!;
            setContentLength(contentLength);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setDownloaded(downloaded);
            // Guard against a 0 total (server omitted Content-Length): keep the
            // bar at an indeterminate 0% instead of NaN/Infinity.
            const percent = contentLength > 0 ? Math.floor((downloaded / contentLength) * 100) : 0;
            setProgress(percent);
            if (downloaded - lastLogged >= 1 * 1024 * 1024) {
              console.log(`downloaded ${downloaded} bytes from ${contentLength}`);
              lastLogged = downloaded;
            }
            break;
          case 'Finished':
            console.log('download finished');
            setProgress(100);
            break;
        }
      });
      console.log('package installed');
    } catch (error) {
      console.error('Failed to download and install update:', error);
      setError(_('Failed to download and install update'));
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isMounted) {
    return null;
  }

  if (error) {
    return (
      <div className='bg-base-100 flex min-h-screen items-center justify-center'>
        <p className='text-base-content text-sm font-bold'>{error}</p>
      </div>
    );
  }

  if (!newVersion) {
    return null;
  }

  return (
    <div className='bg-base-100 flex min-h-screen justify-center'>
      <div className='flex w-full max-w-2xl flex-col gap-4'>
        <div className='flex flex-col justify-center gap-4 sm:flex-row sm:items-start'>
          <div className='flex items-center justify-center'>
            <Image src='/icon.png' alt='Logo' className='h-20 w-20' width={64} height={64} />
          </div>

          {checkUpdate ? (
            <div className='text-base-content grow text-sm'>
              <h2 className='mb-4 text-center font-bold sm:text-start'>
                {_('A new version of Our Reader is available!')}
              </h2>
              <p className='mb-2'>
                {_(
                  'Our Reader {{newVersion}} is available (installed version {{currentVersion}}).',
                  {
                    newVersion,
                    currentVersion,
                  },
                )}
              </p>
              <p className='mb-2'>{_('Download and install now?')}</p>

              <div className='flex w-full flex-row items-center justify-end gap-4'>
                {progress !== null && (
                  <div className='flex grow flex-col'>
                    <progress
                      className='progress my-1 h-4 w-full'
                      value={progress}
                      max='100'
                    ></progress>
                    <p className='text-base-content/75 flex items-center justify-center text-sm'>
                      {progress < 100
                        ? _('Downloading {{downloaded}} of {{contentLength}}', {
                            downloaded: downloaded
                              ? `${Math.floor(downloaded / 1024 / 1024)} MB`
                              : '0 MB',
                            contentLength: contentLength
                              ? `${Math.floor(contentLength / 1024 / 1024)} MB`
                              : '0 MB',
                          })
                        : _('Download finished')}
                    </p>
                  </div>
                )}

                <div className={clsx('card-actions', isDownloading && 'hidden sm:flex')}>
                  <button
                    className={clsx(
                      'btn btn-warning text-base-100 px-6 font-bold',
                      (!update || isDownloading) && 'btn-disabled',
                    )}
                    onClick={handleDownloadInstall}
                  >
                    {update?.openReleasePage ? _('OPEN RELEASE PAGE') : _('DOWNLOAD & INSTALL')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className='text-base-content flex h-full grow flex-col text-sm sm:flex-row'>
              <div className='flex flex-col items-center justify-center gap-4 p-1 sm:items-start sm:gap-2'>
                <h2 className='text-center font-bold sm:text-start'>
                  {_('Version {{version}}', { version: currentVersion })}
                </h2>

                {changelogs.length > 0 && semver.gt(changelogs[0]!.version, currentVersion) ? (
                  <div className='flex gap-2'>
                    {/* Our Reader has no Play Store / App Store listing yet:
                        the update lives on OUR GitHub releases. */}
                    <Link
                      href={OUR_READER_RELEASES_URL}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='btn btn-primary btn-sm'
                    >
                      {_('Check Update')}
                    </Link>
                  </div>
                ) : (
                  <div className='flex'>
                    <p className='text-sm font-bold'>{_('Already the latest version')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className='text-base-content text-sm'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <h3 className='font-bold'>{_('Changelog')}</h3>
            {changelogs.some((entry) => entry.translatedNotes?.length) && (
              <button
                className='btn btn-ghost btn-xs eink-bordered font-normal'
                onClick={() => setShowOriginal((prev) => !prev)}
              >
                {showOriginal ? _('Show translation') : _('Show original')}
              </button>
            )}
          </div>
          <div className='not-eink:bg-base-200 not-eink:px-4 mb-4 rounded-lg pb-2 pt-4'>
            {changelogs.length > 0 ? (
              changelogs.map((entry: Changelog) => (
                <div key={entry.version} className='mb-4'>
                  <h4 className='mb-2 font-bold'>
                    {entry.version} ({entry.date})
                  </h4>
                  <ul className='list-disc space-y-1 ps-6 text-sm'>
                    {(showOriginal ? entry.notes : (entry.translatedNotes ?? entry.notes)).map(
                      (note: string, i: number) => (
                        <li key={i}>{note}</li>
                      ),
                    )}
                  </ul>
                </div>
              ))
            ) : (
              <div className='flex h-56 w-full flex-col gap-4'>
                <div className='skeleton h-4 w-28'></div>
                <div className='skeleton h-4 w-full'></div>
                <div className='skeleton h-4 w-full'></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const setUpdaterWindowVisible = (
  visible: boolean,
  latestVersion: string,
  lastVersion?: string,
  checkUpdate = true,
) => {
  const dialog = document.getElementById('updater_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible, latestVersion, lastVersion, checkUpdate },
    });
    dialog.dispatchEvent(event);
  }
};

export const UpdaterWindow = () => {
  const _ = useTranslation();
  const [latestVersion, setLatestVersion] = useState('');
  const [lastVersion, setLastVersion] = useState('');
  const [checkUpdate, setCheckUpdate] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      const { visible, latestVersion, lastVersion, checkUpdate } = event.detail;
      setIsOpen(visible);
      setCheckUpdate(checkUpdate);
      if (latestVersion) {
        setLatestVersion(latestVersion);
      }
      if (lastVersion) {
        setLastVersion(lastVersion);
      }
    };

    const el = document.getElementById('updater_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='updater_window'
      isOpen={isOpen}
      title={checkUpdate ? _('Software Update') : _("What's New in Our Reader")}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:w-[75%]! sm:h-auto sm:max-h-[85vh]! sm:max-w-2xl!'
    >
      {isOpen && (
        <UpdaterContent
          latestVersion={latestVersion ?? undefined}
          lastVersion={lastVersion ?? undefined}
          checkUpdate={checkUpdate}
        />
      )}
    </Dialog>
  );
};
