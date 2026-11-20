import { getLanguageName, normalizedLangCode } from '@/utils/lang';
import type { TTSVoice, TTSVoicesGroup } from './types';

/**
 * Group a flat voice list by primary language — one collapsible group
 * per language — for the voice picker. The picker renders the groups
 * under an Offline / Online section (see `offline`), so the group name
 * is the language, not the engine.
 */
export const groupVoicesByLanguage = (
  voices: TTSVoice[],
  idPrefix: string,
  offline: boolean,
): TTSVoicesGroup[] => {
  const byLang = new Map<string, TTSVoice[]>();
  for (const voice of voices) {
    const lang = normalizedLangCode(voice.lang);
    const group = byLang.get(lang);
    if (group) {
      if (!group.some((v) => v.id === voice.id)) group.push(voice);
    } else {
      byLang.set(lang, [voice]);
    }
  }
  return [...byLang.entries()]
    .map(
      ([lang, groupVoices]) =>
        ({
          id: `${idPrefix}-${lang}`,
          name: getLanguageName(lang),
          voices: groupVoices,
          offline,
        }) as TTSVoicesGroup,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
};

// One row of the voice picker: either a whole language (collapsible) or
// a single pinned voice.
export type VoicePickerRow = {
  key: string;
  lang: string;
  name: string;
  voices: TTSVoice[];
  // A single pinned voice renders as a direct row, not an accordion.
  single: boolean;
  pinned: boolean;
};

export type VoicePickerSection = {
  key: 'pinned' | 'offline' | 'online';
  title: string;
  rows: VoicePickerRow[];
};

/**
 * Build the picker's Offline / Online sections from the engine groups,
 * with a Pinned section on top. A pinned language keeps all its voices
 * in Pinned (and leaves its normal section); a pinned voice renders as
 * its own row in Pinned. A voice pinned inside a pinned language is
 * shown only once, inside that language's row.
 */
export const buildVoicePickerSections = (
  groups: TTSVoicesGroup[],
  pinnedLangs: string[],
  pinnedVoices: string[],
): VoicePickerSection[] => {
  const pinnedLangSet = new Set(pinnedLangs.map((lang) => normalizedLangCode(lang)));
  const pinnedVoiceSet = new Set(pinnedVoices);
  const seenVoiceIds = new Set<string>();
  const byLang = new Map<string, { name: string; offline: TTSVoice[]; online: TTSVoice[] }>();

  for (const group of groups) {
    for (const voice of group.voices) {
      if (seenVoiceIds.has(voice.id)) continue;
      seenVoiceIds.add(voice.id);
      const lang = normalizedLangCode(voice.lang);
      const entry = byLang.get(lang) ?? { name: getLanguageName(lang), offline: [], online: [] };
      (group.offline ? entry.offline : entry.online).push(voice);
      byLang.set(lang, entry);
    }
  }

  const languageRow = (
    key: string,
    lang: string,
    name: string,
    voices: TTSVoice[],
    pinned: boolean,
  ): VoicePickerRow => ({ key, lang, name, voices, single: false, pinned });

  const pinnedRows: VoicePickerRow[] = [];
  for (const lang of pinnedLangs) {
    const code = normalizedLangCode(lang);
    const entry = byLang.get(code);
    if (!entry) continue;
    const voices = [...entry.offline, ...entry.online];
    if (voices.length > 0)
      pinnedRows.push(languageRow(`pin-${code}`, code, entry.name, voices, true));
  }
  for (const id of pinnedVoices) {
    const voice = [...byLang.values()]
      .flatMap((e) => [...e.offline, ...e.online])
      .find((v) => v.id === id);
    if (!voice) continue;
    if (pinnedLangSet.has(normalizedLangCode(voice.lang))) continue;
    pinnedRows.push({
      key: `pin-voice-${id}`,
      lang: normalizedLangCode(voice.lang),
      name: voice.name,
      voices: [voice],
      single: true,
      pinned: true,
    });
  }

  const sectionRows = (offline: boolean, prefix: string): VoicePickerRow[] =>
    [...byLang.entries()]
      .filter(([lang]) => !pinnedLangSet.has(lang))
      .map(([lang, entry]) => {
        const voices = (offline ? entry.offline : entry.online).filter(
          (voice) => !pinnedVoiceSet.has(voice.id),
        );
        return { lang, entry, voices };
      })
      .filter(({ voices }) => voices.length > 0)
      .sort((a, b) => a.entry.name.localeCompare(b.entry.name))
      .map(({ lang, entry, voices }) =>
        languageRow(`${prefix}-${lang}`, lang, entry.name, voices, false),
      );

  const sections: VoicePickerSection[] = [];
  if (pinnedRows.length > 0) sections.push({ key: 'pinned', title: 'Pinned', rows: pinnedRows });
  const offlineRows = sectionRows(true, 'off');
  if (offlineRows.length > 0)
    sections.push({ key: 'offline', title: 'Offline', rows: offlineRows });
  const onlineRows = sectionRows(false, 'on');
  if (onlineRows.length > 0) sections.push({ key: 'online', title: 'Online', rows: onlineRows });
  return sections;
};
