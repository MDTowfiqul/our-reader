import { describe, expect, test } from 'vitest';
import { buildVoicePickerSections, groupVoicesByLanguage } from '@/services/tts/voiceGroups';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';

const voices = [
  { id: 'edge-bn-1', name: 'Bashkar', lang: 'bn-BD' },
  { id: 'edge-bn-2', name: 'Nabanita', lang: 'bn-IN' },
  { id: 'edge-en-1', name: 'Aria', lang: 'en-US' },
  { id: 'edge-ar-1', name: 'Hamed', lang: 'ar-SA' },
] as TTSVoice[];

describe('groupVoicesByLanguage', () => {
  test('groups by primary language with one group per language', () => {
    const groups = groupVoicesByLanguage(voices, 'edge', false);
    expect(groups.map((g) => g.id)).toEqual(['edge-ar', 'edge-bn', 'edge-en']);
    expect(groups.map((g) => g.name)).toEqual(['Arabic', 'Bengali', 'English']);
    expect(groups.find((g) => g.id === 'edge-bn')?.voices).toHaveLength(2);
    expect(groups.every((g) => g.offline === false)).toBe(true);
  });

  test('dedupes a voice listed twice', () => {
    const groups = groupVoicesByLanguage(
      [...voices, { id: 'edge-bn-1', name: 'Bashkar', lang: 'bn-BD' } as TTSVoice],
      'edge',
      false,
    );
    expect(groups.find((g) => g.id === 'edge-bn')?.voices).toHaveLength(2);
  });

  test('marks device voices offline', () => {
    const groups = groupVoicesByLanguage(
      [{ id: 'bn-bd-x-ban-local', name: 'bn-bd-x-ban-local', lang: 'bn-BD' } as TTSVoice],
      'native',
      true,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe('native-bn');
    expect(groups[0]!.offline).toBe(true);
  });

  test('returns no groups for an empty list', () => {
    expect(groupVoicesByLanguage([], 'edge', false)).toEqual([]);
  });
});

describe('buildVoicePickerSections', () => {
  const groups = [
    {
      id: 'native-bn',
      name: 'Bengali',
      voices: [
        { id: 'bn-1', name: 'Bengali Voice', lang: 'bn-BD' },
        { id: 'bn-2', name: 'Bengali Voice 2', lang: 'bn-IN' },
      ],
      offline: true,
    },
    {
      id: 'edge-bn',
      name: 'Bengali',
      voices: [{ id: 'edge-bn-1', name: 'Bashkar', lang: 'bn-BD' }],
      offline: false,
    },
    {
      id: 'edge-en',
      name: 'English',
      voices: [{ id: 'edge-en-1', name: 'Aria', lang: 'en-US' }],
      offline: false,
    },
    {
      id: 'edge-ar',
      name: 'Arabic',
      voices: [{ id: 'edge-ar-1', name: 'Hamed', lang: 'ar-SA' }],
      offline: false,
    },
  ] as TTSVoicesGroup[];

  test('splits Offline and Online, each grouped by language', () => {
    const sections = buildVoicePickerSections(groups, [], []);
    expect(sections.map((s) => s.key)).toEqual(['offline', 'online']);
    expect(sections[0]!.rows.map((r) => r.key)).toEqual(['off-bn']);
    expect(sections[1]!.rows.map((r) => r.key)).toEqual(['on-ar', 'on-bn', 'on-en']);
    expect(sections[1]!.rows.find((r) => r.key === 'on-bn')?.voices).toHaveLength(1);
  });

  test('a pinned language moves to the Pinned section with all its voices', () => {
    const sections = buildVoicePickerSections(groups, ['bn'], []);
    expect(sections.map((s) => s.key)).toEqual(['pinned', 'online']);
    const pinned = sections[0]!;
    expect(pinned.rows).toHaveLength(1);
    expect(pinned.rows[0]!.key).toBe('pin-bn');
    expect(pinned.rows[0]!.voices).toHaveLength(3);
    expect(sections[1]!.rows.map((r) => r.key)).toEqual(['on-ar', 'on-en']);
  });

  test('a pinned voice renders as its own row in Pinned and leaves its language row', () => {
    const sections = buildVoicePickerSections(groups, [], ['edge-en-1']);
    const pinned = sections.find((s) => s.key === 'pinned')!;
    expect(pinned.rows).toHaveLength(1);
    expect(pinned.rows[0]!.single).toBe(true);
    expect(pinned.rows[0]!.voices[0]!.id).toBe('edge-en-1');
    const online = sections.find((s) => s.key === 'online')!;
    expect(online.rows.map((r) => r.key)).toEqual(['on-ar', 'on-bn']);
  });

  test('a voice pinned inside a pinned language shows only once', () => {
    const sections = buildVoicePickerSections(groups, ['bn'], ['edge-bn-1']);
    const pinned = sections.find((s) => s.key === 'pinned')!;
    expect(pinned.rows).toHaveLength(1);
    expect(pinned.rows[0]!.voices).toHaveLength(3);
  });

  test('returns no sections for an empty list', () => {
    expect(buildVoicePickerSections([], [], [])).toEqual([]);
  });
});
