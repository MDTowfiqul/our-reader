import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import semver from 'semver';

// ── Mocks for Tauri and internal modules ─────────────────────────
const mockOsType = vi.fn();
const mockTauriFetch = vi.fn();

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => mockOsType(),
  arch: () => 'aarch64',
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockTauriFetch(...args),
}));

// WebviewWindow is used with `new`, so the mock must be a constructor
const mockWebviewWindowOnce = vi.fn();
const MockWebviewWindowLastArgs: unknown[][] = [];
vi.mock('@tauri-apps/api/webviewWindow', () => {
  return {
    WebviewWindow: class MockWebviewWindow {
      once = mockWebviewWindowOnce;
      constructor(...args: unknown[]) {
        MockWebviewWindowLastArgs.push(args);
      }
    },
  };
});

const mockSetUpdaterWindowVisible = vi.fn();
vi.mock('@/components/UpdaterWindow', () => ({
  setUpdaterWindowVisible: (...args: unknown[]) => mockSetUpdaterWindowVisible(...args),
}));

let mockIsTauriAppPlatform = false;
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mockIsTauriAppPlatform,
}));

let mockAppVersion = '1.0.0';
vi.mock('@/utils/version', async () => {
  const actual = await vi.importActual<typeof import('@/utils/version')>('@/utils/version');
  return {
    ...actual,
    getAppVersion: () => mockAppVersion,
  };
});

vi.mock('@/services/constants', () => ({
  CHECK_UPDATE_INTERVAL_SEC: 86400,
  OUR_READER_RELEASES_LATEST_API_URL:
    'https://api.github.com/repos/MDTowfiqul/our-reader/releases/latest',
  OUR_READER_RELEASE_APK_ASSET_NAME: 'our-reader-release-apk-arm64.apk',
}));

import {
  checkForAppUpdates,
  checkAppReleaseNotes,
  setLastShownReleaseNotesVersion,
  getLastShownReleaseNotesVersion,
  fetchOurLatestRelease,
} from '@/helpers/updater';

// ── Fixture: one OUR GitHub release, as the releases API returns it ──
const releasePayload = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v2.0.0',
  name: 'Our Reader v2.0.0',
  body: '## Changes\n- First\n- Second',
  published_at: '2026-11-13T00:00:00Z',
  html_url: 'https://github.com/MDTowfiqul/our-reader/releases/tag/v2.0.0',
  assets: [
    {
      name: 'our-reader-release-apk-arm64.apk',
      browser_download_url: 'https://example.com/our-reader-release-apk-arm64.apk',
    },
  ],
  ...overrides,
});

const mockReleaseResponse = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockIsTauriAppPlatform = false;
  mockAppVersion = '1.0.0';
  MockWebviewWindowLastArgs.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper to create a dummy TranslationFunc ─────────────────────
const dummyTranslate = (key: string) => key;

describe('updater', () => {
  // ── fetchOurLatestRelease ──────────────────────────────────────
  describe('fetchOurLatestRelease', () => {
    test('parses the tag and picks the release APK asset', async () => {
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const release = await fetchOurLatestRelease(mockTauriFetch as never);

      expect(release?.version).toBe('2.0.0');
      expect(release?.body).toContain('First');
      expect(release?.apkUrl).toBe('https://example.com/our-reader-release-apk-arm64.apk');
      expect(mockTauriFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/MDTowfiqul/our-reader/releases/latest',
        expect.anything(),
      );
    });

    test('apkUrl is null when the release has no APK asset', async () => {
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ assets: [] })));

      const release = await fetchOurLatestRelease(mockTauriFetch as never);

      expect(release?.version).toBe('2.0.0');
      expect(release?.apkUrl).toBeNull();
    });

    test('returns null when the tag is not a version', async () => {
      mockTauriFetch.mockResolvedValue(
        mockReleaseResponse(releasePayload({ tag_name: 'not-a-release' })),
      );

      expect(await fetchOurLatestRelease(mockTauriFetch as never)).toBeNull();
    });

    test('returns null when the response is not ok', async () => {
      mockTauriFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

      expect(await fetchOurLatestRelease(mockTauriFetch as never)).toBeNull();
    });

    test('returns null when the fetch throws', async () => {
      mockTauriFetch.mockRejectedValue(new Error('Network error'));

      expect(await fetchOurLatestRelease(mockTauriFetch as never)).toBeNull();
    });
  });

  // ── setLastShownReleaseNotesVersion / getLastShownReleaseNotesVersion ──
  describe('release notes version tracking', () => {
    test('getLastShownReleaseNotesVersion returns empty string when not set', () => {
      expect(getLastShownReleaseNotesVersion()).toBe('');
    });

    test('setLastShownReleaseNotesVersion stores value in localStorage', () => {
      setLastShownReleaseNotesVersion('2.0.0');
      expect(getLastShownReleaseNotesVersion()).toBe('2.0.0');
    });

    test('overwrites previous value', () => {
      setLastShownReleaseNotesVersion('1.0.0');
      setLastShownReleaseNotesVersion('2.0.0');
      expect(getLastShownReleaseNotesVersion()).toBe('2.0.0');
    });
  });

  // ── checkForAppUpdates ─────────────────────────────────────────
  describe('checkForAppUpdates', () => {
    test('skips check when auto-check and interval has not elapsed', async () => {
      const now = Date.now();
      localStorage.setItem('lastAppUpdateCheck', now.toString());

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockTauriFetch).not.toHaveBeenCalled();
    });

    test('proceeds with check when interval has elapsed', async () => {
      const pastTime = Date.now() - 86400 * 1000 - 1000;
      localStorage.setItem('lastAppUpdateCheck', pastTime.toString());

      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ tag_name: 'v1.0.0' })));

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockTauriFetch).toHaveBeenCalled();
    });

    test('proceeds when no previous check timestamp', async () => {
      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ tag_name: 'v1.0.0' })));

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockTauriFetch).toHaveBeenCalled();
    });

    test('always checks when isAutoCheck is false', async () => {
      const now = Date.now();
      localStorage.setItem('lastAppUpdateCheck', now.toString());

      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ tag_name: 'v1.0.0' })));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
      expect(mockTauriFetch).toHaveBeenCalled();
    });

    test('returns true and shows update window when update available on macOS', async () => {
      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(true);
      expect(MockWebviewWindowLastArgs).toHaveLength(1);
      expect(MockWebviewWindowLastArgs[0]![0]).toBe('updater');
      expect(MockWebviewWindowLastArgs[0]![1]).toEqual(
        expect.objectContaining({
          url: '/updater?latestVersion=2.0.0',
          title: 'Software Update',
        }),
      );
    });

    test('returns false on desktop when the release is not newer', async () => {
      mockOsType.mockReturnValue('windows');
      mockAppVersion = '2.0.0';
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);
      expect(result).toBe(false);
      expect(MockWebviewWindowLastArgs).toHaveLength(0);
    });

    test('returns true on linux when a newer OUR release exists', async () => {
      mockOsType.mockReturnValue('linux');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);
      expect(result).toBe(true);
    });

    test('nightly channel never offers an update', async () => {
      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false, 'nightly');

      expect(result).toBe(false);
      expect(mockTauriFetch).not.toHaveBeenCalled();
      expect(MockWebviewWindowLastArgs).toHaveLength(0);
    });

    test('Android shows the update window when a newer release has the APK', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '1.0.0';
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalledWith(true, '2.0.0', '1.0.0');
    });

    test('Android offers nothing when the newer release has no APK asset', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '1.0.0';
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ assets: [] })));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
      expect(mockSetUpdaterWindowVisible).not.toHaveBeenCalled();
    });

    test('Android returns false when version is not newer', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '2.0.0';
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
      expect(mockSetUpdaterWindowVisible).not.toHaveBeenCalled();
    });

    test('Android fetch failure throws error on manual check', async () => {
      mockOsType.mockReturnValue('android');
      mockTauriFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

      await expect(checkForAppUpdates(dummyTranslate, false)).rejects.toThrow(
        'Failed to fetch Our Reader release info',
      );
    });

    test('auto-check swallows the release fetch failure', async () => {
      mockOsType.mockReturnValue('android');
      mockTauriFetch.mockRejectedValue(new Error('Network error'));

      // Auto-check runs fire-and-forget on mount; a network failure must resolve
      // false, not reject (which would become an unhandled rejection).
      await expect(checkForAppUpdates(dummyTranslate, true)).resolves.toBe(false);
    });

    test('returns false for unsupported OS types', async () => {
      mockOsType.mockReturnValue('ios');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
    });

    test('stores check timestamp in localStorage', async () => {
      mockOsType.mockReturnValue('macos');
      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload({ tag_name: 'v1.0.0' })));

      const before = Date.now();
      await checkForAppUpdates(dummyTranslate, false);
      const after = Date.now();

      const stored = parseInt(localStorage.getItem('lastAppUpdateCheck')!, 10);
      expect(stored).toBeGreaterThanOrEqual(before);
      expect(stored).toBeLessThanOrEqual(after);
    });
  });

  // ── checkAppReleaseNotes ───────────────────────────────────────
  describe('checkAppReleaseNotes', () => {
    test('shows release notes when current version is newer than last shown', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue(mockReleaseResponse(releasePayload()));
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalledWith(true, '2.0.0', '1.0.0', false);
    });

    test('returns false when current version equals last shown', async () => {
      mockAppVersion = '1.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('sets current version as last shown when no previous version recorded', async () => {
      mockAppVersion = '1.5.0';

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
      expect(getLastShownReleaseNotesVersion()).toBe('1.5.0');
    });

    test('shows release notes when isAutoCheck is false regardless of version comparison', async () => {
      mockAppVersion = '1.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue(mockReleaseResponse(releasePayload()));
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(false);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalled();
    });

    test('returns false when the release fetch fails', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('returns false when the release response is not ok', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('uses tauri fetch when on tauri platform', async () => {
      mockIsTauriAppPlatform = true;
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      mockTauriFetch.mockResolvedValue(mockReleaseResponse(releasePayload()));

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(true);
      expect(mockTauriFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/MDTowfiqul/our-reader/releases/latest',
        expect.anything(),
      );
    });
  });

  // ── semver usage validation ────────────────────────────────────
  describe('semver gt (sanity checks for the logic used)', () => {
    test('2.0.0 is greater than 1.0.0', () => {
      expect(semver.gt('2.0.0', '1.0.0')).toBe(true);
    });

    test('1.0.0 is not greater than 2.0.0', () => {
      expect(semver.gt('1.0.0', '2.0.0')).toBe(false);
    });

    test('equal versions return false', () => {
      expect(semver.gt('1.0.0', '1.0.0')).toBe(false);
    });
  });
});
