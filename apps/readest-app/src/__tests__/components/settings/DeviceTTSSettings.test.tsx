/**
 * DeviceTTSSettings — Google Device TTS controls in Settings → TTS.
 *
 * The voice list must come from a fresh speechSynthesis.getVoices() read
 * (plus voiceschanged refreshes), never a stale empty cache; a voice choice
 * is stored per language via TTSUtils so the reader plays books in that
 * language with it; speed/pitch persist through saveViewSettings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import type { ViewSettings } from '@/types/book';

const state = vi.hoisted(() => ({
  viewSettings: {
    ttsRate: 1.3,
    ttsPitch: 1.0,
  } as unknown as ViewSettings,
  voices: [] as { name: string; lang: string; voiceURI: string }[],
  listeners: {} as Record<string, () => void>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => state.viewSettings }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: state.viewSettings } }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

import { saveViewSettings } from '@/helpers/settings';
import DeviceTTSSettings from '@/components/settings/DeviceTTSSettings';

const installSpeech = () => {
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      getVoices: () => state.voices,
      addEventListener: vi.fn((event: string, fn: () => void) => {
        state.listeners[event] = fn;
      }),
      removeEventListener: vi.fn(),
    },
    configurable: true,
  });
};

describe('DeviceTTSSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    state.voices = [
      { name: 'Google US English', lang: 'en-US', voiceURI: 'google-us' },
      { name: 'Google বাংলা', lang: 'bn-IN', voiceURI: 'google-bn' },
    ];
    state.listeners = {};
    installSpeech();
  });

  afterEach(() => {
    cleanup();
  });

  it('lists all device voices with speed and pitch controls', () => {
    render(<DeviceTTSSettings bookKey='book-1' />);
    expect(screen.getByText('Google Device TTS')).toBeTruthy();
    expect(screen.getByText('Google US English (en-US)')).toBeTruthy();
    expect(screen.getByText('Google বাংলা (bn-IN)')).toBeTruthy();
    expect(screen.getByText('1.30×')).toBeTruthy();
    expect(screen.getByText('1.0')).toBeTruthy();
  });

  it('stores the chosen voice as the preferred voice for its language', () => {
    render(<DeviceTTSSettings bookKey='book-1' />);
    fireEvent.change(screen.getByLabelText('Device voice'), {
      target: { value: 'google-bn' },
    });
    const prefs = JSON.parse(localStorage.getItem('ttsPreferredVoices') || '{}');
    expect(prefs['web-speech-bn']).toBe('google-bn');
  });

  it('refreshes the list when voices arrive late via voiceschanged', () => {
    state.voices = [];
    render(<DeviceTTSSettings bookKey='book-1' />);
    expect(screen.getByText(/No device voices found/)).toBeTruthy();
    state.voices = [{ name: 'Google US English', lang: 'en-US', voiceURI: 'google-us' }];
    act(() => {
      state.listeners['voiceschanged']?.();
    });
    expect(screen.getByText('Google US English (en-US)')).toBeTruthy();
  });

  it('persists speed changes through saveViewSettings', () => {
    render(<DeviceTTSSettings bookKey='book-1' />);
    fireEvent.change(screen.getByLabelText('Device speech speed'), {
      target: { value: '1.5' },
    });
    expect(saveViewSettings).toHaveBeenCalledWith(
      expect.anything(),
      'book-1',
      'ttsRate',
      1.5,
      false,
      false,
    );
  });

  it('persists pitch changes through saveViewSettings', () => {
    render(<DeviceTTSSettings bookKey='book-1' />);
    fireEvent.change(screen.getByLabelText('Device speech pitch'), {
      target: { value: '0.8' },
    });
    expect(saveViewSettings).toHaveBeenCalledWith(
      expect.anything(),
      'book-1',
      'ttsPitch',
      0.8,
      false,
      false,
    );
  });
});
