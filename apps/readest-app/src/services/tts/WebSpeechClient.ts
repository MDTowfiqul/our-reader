import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import { TTSCapabilities, TTSClient, TTSMessageEvent } from './TTSClient';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { WEB_SPEECH_BLACKLISTED_VOICES } from './TTSData';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';

interface TTSBoundaryEvent {
  type: 'boundary' | 'end' | 'error';
  speaking: boolean;
  name?: string;
  mark?: string;
  charIndex?: number;
  charLength?: number;
  error?: string;
}

async function* speakWithMarks(
  ssml: string,
  primaryLang: string,
  getRate: () => number,
  getPitch: () => number,
  getVoice: (lang: string) => Promise<SpeechSynthesisVoice | null>,
  setCurrentVoice: (voiceId: string) => void,
  setSpeakingLang: (lang: string) => void,
  dispatchSpeakMark: (mark: TTSMark) => void,
) {
  const { marks } = parseSSMLMarks(ssml, primaryLang);
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance();
  for (const mark of marks) {
    const { language: voiceLang } = mark;
    dispatchSpeakMark(mark);
    utterance.text = mark.text;
    utterance.rate = getRate();
    utterance.pitch = getPitch();
    const voice = await getVoice(voiceLang);
    if (voice) {
      utterance.voice = voice;
      setCurrentVoice(voice.voiceURI);
    }
    if (voiceLang) {
      utterance.lang = voiceLang;
      setSpeakingLang(voiceLang);
    }

    yield {
      type: 'boundary',
      speaking: true,
      name: 'sentence',
      mark: mark.name,
    } as TTSBoundaryEvent;

    const result = await new Promise<TTSBoundaryEvent>((resolve) => {
      utterance.onend = () => resolve({ type: 'end', speaking: false });
      utterance.onerror = (event) =>
        resolve({
          type: 'error',
          speaking: false,
          error: event.error,
        });

      synth.speak(utterance);
    });

    yield result;
    if (result.type === 'error') {
      break;
    }
  }
}

type WebSpeechVoice = SpeechSynthesisVoice & {
  id: string;
};

// How long to wait for 'voiceschanged' before giving up on the voice list.
// Chrome populates it asynchronously on first call, so some wait is required;
// a platform with no voices at all never fires the event.
const WEB_SPEECH_VOICES_TIMEOUT_MS = 2000;

export class WebSpeechClient implements TTSClient {
  name = 'web-speech';
  initialized = false;
  controller?: TTSController;

  #voices: WebSpeechVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;

  #synth = window.speechSynthesis;

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  // Re-read the browser's voice list fresh. Chrome on Android often
  // delivers voices only after the first call, so a list cached at init
  // time can stay empty forever; reading it here keeps the picker honest.
  #refreshVoices() {
    if (!this.#synth) return;
    this.#voices = this.#synth.getVoices().map((voice) => {
      const webSpeechVoice = voice as WebSpeechVoice;
      webSpeechVoice.id = voice.voiceURI || voice.name;
      return webSpeechVoice;
    });
  }

  // Chrome on Android sometimes reports no voices until the speech engine
  // is actually used once. A silent utterance (volume 0, cancelled as soon
  // as voices arrive) is the user-gesture-safe nudge that makes the engine
  // report its voices; without it the picker can stay empty forever even
  // though voices are installed. Guarded so a missing engine never throws.
  #voiceLoadKicked = false;
  #kickVoiceLoad() {
    const synth = this.#synth;
    if (!synth || this.#voiceLoadKicked || typeof SpeechSynthesisUtterance === 'undefined') {
      return;
    }
    this.#voiceLoadKicked = true;
    try {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      const stop = () => {
        try {
          synth.cancel();
        } catch {
          // Engine absent mid-load; nothing to cancel.
        }
        this.#refreshVoices();
      };
      synth.addEventListener('voiceschanged', stop, { once: true });
      synth.speak(utterance);
      setTimeout(stop, 1500);
    } catch {
      // No speech engine; the empty list stands.
    }
  }

  async init() {
    if (!this.#synth) {
      this.initialized = false;
      return this.initialized;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const populateVoices = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#refreshVoices();
        // console.log('Voices', this.#voices);
        resolve();
      };

      // A platform with no speech voices installed (a bare Linux desktop with
      // no speech-dispatcher, headless Chromium) reports an empty voice list
      // and never fires 'voiceschanged'. Waiting forever wedges the whole of
      // TTSController.init(), which takes every other engine down with it —
      // including recorded narration, which needs no system voice at all.
      const timer = setTimeout(() => {
        if (settled) return;
        console.warn('[TTS] no Web Speech voices reported; continuing without them');
        populateVoices();
      }, WEB_SPEECH_VOICES_TIMEOUT_MS);

      if (this.#synth.getVoices().length > 0) {
        populateVoices();
      } else if (this.#synth.onvoiceschanged !== undefined) {
        this.#synth.onvoiceschanged = populateVoices;
        // Nudge the engine to report: without a first use, some phones
        // never fire voiceschanged at all.
        this.#kickVoiceLoad();
      } else {
        console.warn('Voiceschanged event not supported.');
        populateVoices();
      }
    });
    // Late voices must still reach the picker: the first populate above
    // resolves init (and the 2s timeout keeps platforms with genuinely no
    // voices from wedging TTSController.init()), but from here on every
    // voiceschanged event refreshes the cached list instead of being
    // swallowed by the settled flag.
    if (this.#synth.onvoiceschanged !== undefined) {
      this.#synth.onvoiceschanged = () => this.#refreshVoices();
    }
    this.initialized = true;
    return this.initialized;
  }

  getVoiceIdFromLang = async (lang: string) => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    const defaultVoice = preferredVoice
      ? preferredVoice
      : (await this.getVoices(lang))[0]?.voices[0] || null;
    return defaultVoice?.id || this.#currentVoiceId || '';
  };

  getWebSpeechVoiceFromLang = async (lang: string) => {
    const voiceId = await this.getVoiceIdFromLang(lang);
    return this.#voices.find((v) => v.id === voiceId) || null;
  };

  async *speak(
    ssml: string,
    signal: AbortSignal,
    preload = false,
  ): AsyncGenerator<TTSMessageEvent> {
    // no need to preload for web speech
    if (preload) return;

    for await (const ev of speakWithMarks(
      ssml,
      this.#primaryLang,
      () => this.#rate,
      () => this.#pitch,
      this.getWebSpeechVoiceFromLang,
      (voiceId) => (this.#currentVoiceId = voiceId),
      (lang) => (this.#speakingLang = lang),
      (mark) => this.controller?.dispatchSpeakMark(mark),
    )) {
      if (signal.aborted) {
        console.log('TTS aborted');
        yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
        return;
      }
      if (ev.type === 'boundary') {
        yield {
          code: 'boundary',
          mark: ev.mark ?? '',
          message: `${ev.name ?? 'Unknown'} ${ev.charIndex ?? 0}/${ev.charLength ?? 0}`,
        } as TTSMessageEvent;
      } else if (ev.type === 'error') {
        yield { code: 'error', message: ev.error ?? 'Unknown error' } as TTSMessageEvent;
      } else if (ev.type === 'end') {
        yield { code: 'end', message: 'Speech finished' } as TTSMessageEvent;
      }
    }
  }

  async pause() {
    this.#synth.pause();
    return true;
  }

  async resume() {
    this.#synth.resume();
    return true;
  }

  async stop() {
    this.#synth.cancel();
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  async setRate(rate: number) {
    // The Web Speech API uses utterance.rate in [0.1 .. 10],
    this.#rate = rate;
  }

  async setPitch(pitch: number) {
    // The Web Speech API uses pitch in [0 .. 2].
    this.#pitch = pitch;
  }

  async setVoice(voiceId: string) {
    this.#refreshVoices();
    const selectedVoice = this.#voices.find((v) => v.id === voiceId);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#refreshVoices();
    const voices = this.#voices.map((voice) => {
      return {
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
        disabled: !this.initialized,
      } as TTSVoice;
    });
    return voices;
  }

  async getVoices(lang: string) {
    this.#refreshVoices();
    if (this.#voices.length === 0) {
      // First open on a phone whose engine has not reported yet: nudge it
      // and wait briefly for the voices to arrive instead of returning
      // an empty picker on the spot.
      this.#kickVoiceLoad();
      await new Promise<void>((resolve) => {
        const synth = this.#synth;
        if (!synth) {
          resolve();
          return;
        }
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, 1200);
        synth.addEventListener('voiceschanged', done, { once: true });
      });
      this.#refreshVoices();
      this.#voiceLoadKicked = false;
    }
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const isNotBlacklisted = (voice: SpeechSynthesisVoice) => {
      return (
        !voice.voiceURI.startsWith('com.apple.eloquence.') &&
        !voice.voiceURI.startsWith('com.apple.speech.synthesis.voice.') &&
        !WEB_SPEECH_BLACKLISTED_VOICES.some((name) => voice.name.includes(name))
      );
    };
    // Match by primary language so the voice set stays the same across a book
    // whose sections mix region variants (e.g. en-US front matter and en-GB
    // body text); the requested locale's voices sort first. See #4033.
    const matchedVoices = this.#voices
      .filter((voice) => isSameLang(voice.lang, lang))
      .filter(isNotBlacklisted);
    // "Use web TTS" fallback: when the phone has device voices but none for
    // the book's language, showing 0 voices (and refusing to play) is worse
    // than speaking with another language's voice. The group name says so
    // plainly, so a Bengali book read by an English voice is never passed
    // off as a Bengali voice. Installing the book's language remains the
    // real fix; this only unblocks playback until then.
    const isFallback = matchedVoices.length === 0;
    const filteredVoices = isFallback
      ? this.#voices.filter(isNotBlacklisted)
      : matchedVoices;
    const availableVoiceIds = new Set(filteredVoices.map((voice) => voice.voiceURI));
    const seenIds = new Set<string>();
    const voices = filteredVoices
      // Keep compact voices as a fallback when no higher-quality variant is installed.
      .filter((voice) => {
        const compactPrefix = 'com.apple.voice.compact.';
        if (!voice.voiceURI.startsWith(compactPrefix)) return true;
        const voiceSuffix = voice.voiceURI.slice(compactPrefix.length);
        return (
          !availableVoiceIds.has(`com.apple.voice.enhanced.${voiceSuffix}`) &&
          !availableVoiceIds.has(`com.apple.voice.premium.${voiceSuffix}`)
        );
      })
      .map(
        (voice) =>
          ({
            id: voice.voiceURI,
            name: voice.name,
            lang: voice.lang,
          }) as TTSVoice,
      )
      .filter((voice) => {
        if (seenIds.has(voice.id)) {
          return false;
        }
        seenIds.add(voice.id);
        return true;
      });
    voices.forEach((voice) => {
      voice.disabled = !this.initialized;
    });

    const voicesGroup: TTSVoicesGroup = {
      id: 'web-speech-api',
      name: isFallback ? 'Google Device TTS (other languages)' : 'Google Device TTS',
      voices: voices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
      disabled: !this.initialized || voices.length === 0,
    };
    return [voicesGroup];
  }

  getCapabilities(): TTSCapabilities {
    // Direct-speak engine: the OS renders the audio, so there is no media
    // clock, no word boundaries, and no gap or live-rate control.
    return { wordBoundaries: false, mediaClock: false, gapControl: false, liveRateChange: false };
  }

  getGranularities(): TTSGranularity[] {
    // currently only support sentence boundary and disable word boundary as changing voice
    // in the middle of speech is not possible for different granularities
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.#voices = [];
    await this.stop();
  }
}
