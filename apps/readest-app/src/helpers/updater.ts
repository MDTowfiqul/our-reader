import semver from 'semver';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ScrollBarStyle } from '@tauri-apps/api/window';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch } from '@tauri-apps/plugin-http';
import { TranslationFunc } from '@/hooks/useTranslation';
import { setUpdaterWindowVisible } from '@/components/UpdaterWindow';
import { isTauriAppPlatform } from '@/services/environment';
import { getAppVersion, isUpdateNewer } from '@/utils/version';
import {
  CHECK_UPDATE_INTERVAL_SEC,
  OUR_READER_RELEASES_LATEST_API_URL,
  OUR_READER_RELEASE_APK_ASSET_NAME,
} from '@/services/constants';

const LAST_CHECK_KEY = 'lastAppUpdateCheck';

const showUpdateWindow = (latestVersion: string, scrollBarStyle: ScrollBarStyle) => {
  const win = new WebviewWindow('updater', {
    url: `/updater?latestVersion=${latestVersion}`,
    title: 'Software Update',
    width: 626,
    height: 406,
    center: true,
    resizable: true,
    scrollBarStyle,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
};

type FetchFn = typeof fetch;

/**
 * One release of Our Reader, read from OUR GitHub releases
 * (api.github.com/repos/MDTowfiqul/our-reader/releases/latest). The updater
 * never talks to upstream Readest: no download.readest.com manifest, no
 * Tauri updater endpoint, no nightly channel.
 */
export interface OurReaderRelease {
  /** Version without the leading `v`, e.g. `0.12.17`. */
  version: string;
  name: string;
  /** Release notes body, as published on the release. */
  body: string;
  publishedAt: string;
  htmlUrl: string;
  /** Direct download URL of the arm64 release APK asset, if attached. */
  apkUrl: string | null;
}

const stripReleaseTagPrefix = (tag: string): string | null => {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  return semver.valid(version) ? version : null;
};

/** Fetch OUR latest release; `null` when unreachable, malformed, or untagged. */
export const fetchOurLatestRelease = async (fetchFn: FetchFn): Promise<OurReaderRelease | null> => {
  try {
    const res = await fetchFn(OUR_READER_RELEASES_LATEST_API_URL, {
      connectTimeout: 5000,
    } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: unknown;
      name?: unknown;
      body?: unknown;
      published_at?: unknown;
      html_url?: unknown;
      assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
    };
    const version = stripReleaseTagPrefix(String(data.tag_name ?? ''));
    if (!version) return null;
    const apk = (data.assets ?? []).find(
      (asset) => asset?.name === OUR_READER_RELEASE_APK_ASSET_NAME,
    );
    return {
      version,
      name: String(data.name ?? ''),
      body: String(data.body ?? ''),
      publishedAt: String(data.published_at ?? ''),
      htmlUrl: String(data.html_url ?? ''),
      apkUrl: typeof apk?.browser_download_url === 'string' ? apk.browser_download_url : null,
    };
  } catch (err) {
    console.warn('Failed to fetch Our Reader release info', err);
    return null;
  }
};

export const checkForAppUpdates = async (
  _: TranslationFunc,
  isAutoCheck = true,
  updateChannel: 'stable' | 'nightly' = 'stable',
): Promise<boolean> => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (isAutoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return false;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  console.log('Checking for updates', { updateChannel });
  const OS_TYPE = osType();

  // Our Reader ships no nightly builds: the nightly channel never offers
  // anything (and never falls back to upstream Readest nightlies).
  if (updateChannel === 'nightly') return false;

  try {
    const release = await fetchOurLatestRelease(fetch);
    if (!release) {
      if (!isAutoCheck) throw new Error('Failed to fetch Our Reader release info');
      return false;
    }
    const isNewer = isUpdateNewer(release.version, getAppVersion());

    if (OS_TYPE === 'android') {
      // Android installs the release APK from OUR GitHub release. A newer
      // release without the APK asset is not installable, so it offers
      // nothing rather than pointing at upstream.
      if (isNewer && release.apkUrl) {
        setUpdaterWindowVisible(true, release.version, getAppVersion());
        return true;
      }
      return false;
    }

    if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
      // Desktop has no Our Reader updater artifacts yet: offer the release
      // (the updater window links to the GitHub release page) but never
      // install anything itself.
      if (isNewer) {
        // Enum ScrollBarStyle is exported as type by tauri, so it cannot be used directly.
        const scrollBarStyle = (OS_TYPE === 'windows'
          ? 'fluentOverlay'
          : 'default') as unknown as ScrollBarStyle;
        showUpdateWindow(release.version, scrollBarStyle);
        return true;
      }
      return false;
    }

    return false;
  } catch (err) {
    // Update checks are best-effort: they fail routinely when offline or when
    // the release host is unreachable. An auto-check runs fire-and-forget on
    // mount, so throwing here becomes an unhandled rejection. Only surface
    // the failure for a manual check (About window).
    console.warn('Update check failed', err);
    if (!isAutoCheck) throw err;
    return false;
  }
};

const LAST_SHOWN_RELEASE_NOTES_KEY = 'lastShownReleaseNotesVersion';

export const setLastShownReleaseNotesVersion = (version: string) => {
  localStorage.setItem(LAST_SHOWN_RELEASE_NOTES_KEY, version);
};

export const getLastShownReleaseNotesVersion = () => {
  return localStorage.getItem(LAST_SHOWN_RELEASE_NOTES_KEY) || '';
};

export const checkAppReleaseNotes = async (isAutoCheck = true) => {
  const currentVersion = getAppVersion();
  const lastShownVersion = getLastShownReleaseNotesVersion();
  if ((lastShownVersion && semver.gt(currentVersion, lastShownVersion)) || !isAutoCheck) {
    try {
      const fetchFunc = isTauriAppPlatform() ? fetch : window.fetch;
      const release = await fetchOurLatestRelease(fetchFunc as unknown as FetchFn);
      if (release) {
        setUpdaterWindowVisible(true, release.version, lastShownVersion, false);
        return true;
      }
    } catch (err) {
      console.warn('Failed to fetch release notes', err);
    }
  } else if (!lastShownVersion) {
    setLastShownReleaseNotesVersion(currentVersion);
  }
  return false;
};
