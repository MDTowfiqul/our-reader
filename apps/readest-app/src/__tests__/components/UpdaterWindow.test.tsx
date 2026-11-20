/**
 * UpdaterContent — updates from OUR GitHub releases, and the "What's New in
 * Our Reader" changelog.
 *
 * When the UI locale is non-English, the release notes are auto-translated in
 * place. These tests cover the "Show original" toggle that lets the reader flip
 * the auto-translated changelog back to the source English text (and back),
 * plus the Android APK download from OUR release asset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Locale + translation controls ────────────────────────────────
let mockLocale = 'en';
let mockOS = 'macos';
const mockTranslate = vi.fn(async (input: string[]) => input.map((s) => `[zh] ${s}`));

vi.mock('@/utils/misc', () => ({
  getLocale: () => mockLocale,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mockTranslate,
    translator: null,
    translators: [],
    loading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      hasUpdater: true,
      isIOSApp: false,
      isMacOSApp: false,
      isAndroidApp: mockOS === 'android',
      resolveFilePath: async (name: string) => `/cache/${name}`,
    },
  }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const mockAppVersion = '0.11.0';
vi.mock('@/utils/version', async () => {
  const actual = await vi.importActual<typeof import('@/utils/version')>('@/utils/version');
  return { ...actual, getAppVersion: () => mockAppVersion };
});

vi.mock('@/helpers/updater', async () => {
  const actual = await vi.importActual<typeof import('@/helpers/updater')>('@/helpers/updater');
  return {
    setLastShownReleaseNotesVersion: vi.fn(),
    fetchOurLatestRelease: actual.fetchOurLatestRelease,
  };
});

vi.mock('@/services/constants', () => ({
  OUR_READER_RELEASES_LATEST_API_URL:
    'https://api.github.com/repos/MDTowfiqul/our-reader/releases/latest',
  OUR_READER_RELEASES_URL: 'https://github.com/MDTowfiqul/our-reader/releases/latest',
  OUR_READER_RELEASE_APK_ASSET_NAME: 'our-reader-release-apk-arm64.apk',
}));

// ── Tauri / heavy modules pulled in by UpdaterWindow's top-level imports ──
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => mockOS, arch: () => 'aarch64' }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@/utils/transfer', () => ({ tauriDownload: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  installPackage: vi.fn(),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/Link', () => ({ default: () => null }));

import { UpdaterContent } from '@/components/UpdaterWindow';
import { tauriDownload } from '@/utils/transfer';
import { installPackage } from '@/utils/bridge';

// ── Fixture: OUR GitHub release, as the releases API returns it ──
const ourRelease = (tag: string) => ({
  tag_name: `v${tag}`,
  name: `Our Reader ${tag}`,
  body: '- First feature\n- Second feature',
  published_at: '2026-07-08T00:00:00Z',
  html_url: `https://github.com/MDTowfiqul/our-reader/releases/tag/v${tag}`,
  assets: [
    {
      name: 'our-reader-release-apk-arm64.apk',
      browser_download_url: `https://example.com/our-reader-release-apk-arm64-${tag}.apk`,
    },
  ],
});

beforeEach(() => {
  mockLocale = 'en';
  mockOS = 'macos';
  vi.mocked(tauriDownload).mockReset();
  vi.mocked(installPackage).mockReset();
  mockTranslate.mockClear();
  window.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ourRelease('0.11.18'),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('UpdaterContent — OUR GitHub release updates', () => {
  it('contains a stable Android download failure and does not install a partial APK', async () => {
    mockOS = 'android';
    const failure = new Error('Response stream interrupted');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriDownload).mockRejectedValueOnce(failure);
    vi.mocked(window.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ourRelease('0.11.20'),
    } as Response);

    render(<UpdaterContent latestVersion='0.11.20' />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    expect(await screen.findByText('Failed to download and install update')).toBeTruthy();
    expect(tauriDownload).toHaveBeenCalledOnce();
    expect(installPackage).not.toHaveBeenCalled();
  });

  it('on Android downloads OUR single release APK asset', async () => {
    mockOS = 'android';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(tauriDownload).mockRejectedValueOnce(new Error('stop'));
    vi.mocked(window.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ourRelease('0.11.20'),
    } as Response);

    render(<UpdaterContent latestVersion='0.11.20' />);
    fireEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD & INSTALL' }));

    await waitFor(() => expect(tauriDownload).toHaveBeenCalledOnce());
    expect(vi.mocked(tauriDownload).mock.calls[0]!.slice(0, 2)).toEqual([
      'https://example.com/our-reader-release-apk-arm64-0.11.20.apk',
      '/cache/OurReader_0.11.20_arm64.apk',
    ]);
  });

  it('shows a "Show original" toggle that swaps the translation for the source English', async () => {
    mockLocale = 'zh-CN';
    render(<UpdaterContent checkUpdate={false} latestVersion='0.11.18' lastVersion='0.11.0' />);

    // The translated notes render by default (current behavior preserved).
    await waitFor(() => expect(screen.getByText('[zh] First feature')).toBeTruthy());
    expect(mockTranslate).toHaveBeenCalled();
    // The original English is hidden until the reader asks for it.
    expect(screen.queryByText('First feature')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show original' });
    fireEvent.click(toggle);

    // Now the source English is shown, the translation is hidden, label flips.
    await waitFor(() => expect(screen.getByText('First feature')).toBeTruthy());
    expect(screen.queryByText('[zh] First feature')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show translation' })).toBeTruthy();
  });

  it('renders no toggle when the locale is English (nothing was translated)', async () => {
    mockLocale = 'en';
    render(<UpdaterContent checkUpdate={false} latestVersion='0.11.18' lastVersion='0.11.0' />);

    await waitFor(() => expect(screen.getByText('First feature')).toBeTruthy());
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull();
  });
});
