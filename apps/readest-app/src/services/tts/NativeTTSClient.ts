import { invoke } from '@tauri-apps/api/core';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { getUserLocale } from '@/utils/misc';
import { getLanguageName, isSameLang, normalizedLangCode } from '@/utils/lang';
import { parseSSMLMarks } from '@/utils/ssml';
import { stubTranslation as _ } from '@/utils/misc';
import { TTSCapabilities, TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { TTSUtils } from './TTSUtils';
import { TTSController } from './TTSController';

type TTSEventPayload = {
  utteranceId: string;
} & TTSMessageEvent;

const TTSEngines = {
  default: 'System TTS',
  msctts: 'Msc TTS',
  mstrans: 'MSTrans TTS',
  microsoft: 'Microsoft TTS',
  bytedance: 'ByteDance TTS',
  peiyinya: 'PeiYinYa TTS',
  huoshan: 'HuoShan TTS',
  sougou: 'Sougou TTS',
  xiaomi: 'XiaoMi TTS',
  bdetts: 'BDeTTS',
  bdotts: 'BDoTTS',
  vcstts: 'VcsTTS',
  isstts: 'IssTTS',
  xfpeiyin: 'XFPeiYin',
  azure: 'Azure TTS',
  edgetts: 'Edge TTS',
  google: 'Google TTS',
  gemini: 'Gemini TTS',
  weread: 'WeRead TTS',
  aispeech: 'Aispeech',
} as Record<string, string>;

export class NativeTTSClient implements TTSClient {
  name = 'native-tts';
  initialized = false;
  controller?: TTSController;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;

  #eventListener: PluginListener | null = null;
  #activeUtterances = new Map<
    string,
    {
      eventQueue: TTSMessageEvent[];
      resolver: ((value: IteratorResult<TTSMessageEvent>) => void) | null;
      finished: boolean;
    }
  >();

  // Marks already queued natively (mark name -> utterance id). The controller
  // preloads the current paragraph again when live speak starts, and
  // preloadNextSSML re-feeds the same paragraphs, so a preload must not
  // enqueue the same sentence twice — and a live speak must attach to the
  // queued utterance instead of speaking it a second time. The queue is what
  // keeps speech going when the WebView stalls in the background.
  #queuedMarks = new Map<string, string>();

  // True on Android, where the foreground service holds the native queue past
  // a paragraph boundary. On iOS the synthesizer queue is flushed by a stop,
  // so queued marks must be dropped there instead.
  get #isAndroid() {
    return this.controller?.appService?.isAndroidApp ?? false;
  }

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  private async setupEventListener(): Promise<void> {
    try {
      if (this.#eventListener) return;
      this.#eventListener = await addPluginListener<TTSEventPayload>(
        'native-tts',
        'tts_events',
        (event) => {
          const { utteranceId, code, message, mark } = event;

          const utteranceData = this.#activeUtterances.get(utteranceId);
          if (!utteranceData) return;

          const ttsEvent: TTSMessageEvent = { code, message, mark };
          utteranceData.eventQueue.push(ttsEvent);
          if (code === 'end' || code === 'error') {
            utteranceData.finished = true;
            if (utteranceData.resolver) {
              utteranceData.resolver({ value: undefined, done: true });
            }
          } else if (utteranceData.resolver) {
            utteranceData.resolver({ value: ttsEvent, done: false });
            utteranceData.resolver = null;
          }
        },
      );
    } catch (error) {
      console.error('Failed to setup TTS event listener:', error);
    }
  }

  async init(): Promise<boolean> {
    const result = await invoke<{ success: boolean }>('plugin:native-tts|init');
    this.initialized = result.success;
    if (this.initialized) {
      this.setupEventListener();
    }
    return this.initialized;
  }

  async *speakMark(mark: TTSMark, preload: boolean, signal: AbortSignal) {
    if (preload) {
      // Queue the sentence natively and return at once: the controller drains
      // preloads to completion, so awaiting speech here would serialize the
      // whole feed-ahead behind the sentence now sounding. A mark already
      // queued is a no-op.
      if (this.#queuedMarks.has(mark.name)) return;
      const { language: voiceLang } = mark;
      const voiceId = await this.getVoiceIdFromLang(voiceLang);
      this.#currentVoiceId = voiceId;
      this.#speakingLang = voiceLang;
      await this.setVoice(voiceId);
      try {
        const result = await invoke<{ utteranceId: string }>('plugin:native-tts|speak', {
          payload: { text: mark.text, preload: true },
        });
        const utteranceId = result.utteranceId;
        this.#activeUtterances.set(utteranceId, {
          eventQueue: [],
          resolver: null,
          finished: false,
        });
        this.#queuedMarks.set(mark.name, utteranceId);
      } catch (error) {
        console.error('Failed to preload:', error);
        throw error;
      }
      return;
    }

    // Live: a mark already in the native queue is spoken from the queue —
    // invoking speak again would queue (and speak) it twice.
    const queuedId = this.#queuedMarks.get(mark.name);
    if (queuedId && this.#activeUtterances.has(queuedId)) {
      this.#queuedMarks.delete(mark.name);
      yield* this.#drainUtterance(queuedId, mark, signal);
      return;
    }
    this.#queuedMarks.delete(mark.name);

    if (this.#isAndroid) {
      // A fresh live speak flushes the service queue, so every mark still
      // queued is gone with it: drop them (and their utterance entries) or a
      // later live speak would attach to a flushed utterance and wait
      // forever. On iOS the synthesizer queues instead of flushing, so the
      // queued marks stay valid there.
      for (const utteranceId of this.#queuedMarks.values()) {
        this.#activeUtterances.delete(utteranceId);
      }
      this.#queuedMarks.clear();
    }

    const { language: voiceLang } = mark;
    const voiceId = await this.getVoiceIdFromLang(voiceLang);
    this.#currentVoiceId = voiceId;
    this.#speakingLang = voiceLang;
    await this.setVoice(voiceId);
    try {
      const result = await invoke<{ utteranceId: string }>('plugin:native-tts|speak', {
        payload: { text: mark.text, preload: false },
      });

      const utteranceId = result.utteranceId;
      this.#activeUtterances.set(utteranceId, {
        eventQueue: [],
        resolver: null,
        finished: false,
      });
      yield* this.#drainUtterance(utteranceId, mark, signal);
    } catch (error) {
      console.error('Failed to speak:', error);
      throw error;
    }
  }

  // Yield the native events for one utterance (boundary/end/error), from the
  // entry the plugin listener feeds. Shared by a fresh live speak and by a
  // live speak attaching to an already-queued utterance.
  async *#drainUtterance(utteranceId: string, mark: TTSMark, signal: AbortSignal) {
    const abortHandler = () => {
      const utteranceData = this.#activeUtterances.get(utteranceId);
      if (utteranceData && utteranceData.resolver) {
        const error = { code: 'error', message: 'Aborted' } as TTSMessageEvent;
        utteranceData.resolver({ value: error, done: true });
        utteranceData.resolver = null;
      }
      this.stop();
    };

    signal.addEventListener('abort', abortHandler);

    try {
      while (true) {
        const utteranceData = this.#activeUtterances.get(utteranceId);
        if (!utteranceData) break;

        if (utteranceData.eventQueue.length > 0) {
          const event = utteranceData.eventQueue.shift()!;
          event.mark = mark.name;
          yield event;

          if (event.code === 'end' || event.code === 'error') {
            break;
          }
        } else if (utteranceData.finished) {
          break;
        } else {
          const eventPromise = new Promise<TTSMessageEvent | void>((resolve) => {
            const utteranceData = this.#activeUtterances.get(utteranceId);
            if (!utteranceData) return resolve();
            utteranceData.resolver = (res) =>
              resolve(res.value?.code === 'error' ? res.value : undefined);
          });
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 100),
          );
          const result = await Promise.race([eventPromise, timeoutPromise]);
          if (result) yield result;
        }

        if (signal.aborted) {
          break;
        }
      }
    } finally {
      signal.removeEventListener('abort', abortHandler);
      this.#activeUtterances.delete(utteranceId);
    }
  }

  async *speak(ssml: string, signal: AbortSignal, preload: boolean = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    for (const mark of marks) {
      if (!preload) this.controller?.dispatchSpeakMark(mark);
      for await (const ev of this.speakMark(mark, preload, signal)) {
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          return;
        }
        yield ev;
      }
    }
  }

  async getVoiceIdFromLang(lang: string) {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    const defaultVoice = preferredVoice
      ? preferredVoice
      : (await this.getVoices(lang))[0]?.voices[0] || null;
    return defaultVoice?.id || '';
  }

  async pause() {
    // Pausing stops the native engine, which flushes its queue — so the
    // queued marks are gone too. Resume re-speaks the current sentence, which
    // then enqueues fresh.
    this.#queuedMarks.clear();
    await invoke('plugin:native-tts|pause');
    return false;
  }

  async resume() {
    // No-op for Android TextToSpeech
    await invoke('plugin:native-tts|resume');
    return false;
  }

  async stop(handover = false) {
    // A handover (the next paragraph starting) is a no-op on Android: the
    // service is already speaking the next paragraph's queued audio, and
    // cutting it would skip its first sentence. The queued marks stay, so
    // the next live speak attaches to them. On iOS the synthesizer queue is
    // flushed by the stop itself, so the queued marks must be dropped or the
    // next live speak would attach to dead utterances and wait forever.
    // (A user skip mid-sentence is cut by the speak loop's abort handler,
    // which calls the full stop below — not by this handover path.)
    if (handover && this.#isAndroid) return;
    this.#queuedMarks.clear();
    // Bound the native stop so teardown (controller.stop / shutdown, and thus
    // the TTS icon turning off) can never hang if the native side is slow to
    // resolve — e.g. iOS AVSpeechSynthesizer / audio-session teardown. See #4676.
    try {
      await Promise.race([
        invoke('plugin:native-tts|stop'),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (error) {
      console.warn('Native TTS stop failed:', error);
    }
    this.#activeUtterances.clear();
  }

  async setRate(rate: number) {
    // Power the rate to match the EdgeTTS behavior
    this.#rate = parseFloat(Math.pow(rate, 2.5).toFixed(2));
    await invoke('plugin:native-tts|set_rate', { payload: { rate: this.#rate } });
  }

  async setPitch(pitch: number) {
    this.#pitch = pitch;
    await invoke('plugin:native-tts|set_pitch', { payload: { pitch: this.#pitch } });
  }

  async setVoice(voice: string) {
    this.#currentVoiceId = voice;
    await invoke('plugin:native-tts|set_voice', { payload: { voice } });
  }

  async getAllVoices() {
    if (this.#voices.length > 0) {
      return this.#voices;
    }
    try {
      const result = await invoke<{ voices: TTSVoice[] }>('plugin:native-tts|get_all_voices');
      // Match Web Speech's Apple voice-family exclusions. iOS also exposes
      // novelty and legacy Eloquence voices through the native API.
      this.#voices = result.voices.filter(
        (voice) =>
          !voice.id.startsWith('com.apple.eloquence.') &&
          !voice.id.startsWith('com.apple.speech.synthesis.voice.'),
      );
      return this.#voices;
    } catch (error) {
      console.error('Failed to get all voices:', error);
      return [];
    }
  }

  async getVoices(lang: string) {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    // Match by primary language so the voice set stays the same across a book
    // whose sections mix region variants (e.g. en-US front matter and en-GB
    // body text); the requested locale's voices sort first. See #4033.
    const filteredVoices = voices.filter((v) => isSameLang(v.lang, lang));
    // Group by language, not by engine: the picker lists one collapsible
    // group per language (Bengali, English, Arabic, ...), each opening to
    // its voices. The engine prefix is still stripped from display names.
    const voiceGroups = new Map<string, TTSVoice[]>();
    filteredVoices.forEach((voice) => {
      const { name, lang } = voice;
      const groupId = `native-${normalizedLangCode(lang)}`;
      const engineId = voice.id.split('_')[0]!;
      if (engineId in TTSEngines) {
        voice.name = name
          .replace(`${engineId}_`, '')
          .replace(`${lang}-`, '')
          .replace('Neural', '')
          .trim();
      }
      voice.name = voice.name.replace('NOT_SET', _('Default'));
      if (!voiceGroups.has(groupId)) {
        voiceGroups.set(groupId, []);
      }
      voiceGroups.get(groupId)!.push(voice);
    });

    return Array.from(voiceGroups.entries())
      .map(
        ([groupId, voices]) =>
          ({
            id: groupId,
            name: getLanguageName(groupId.replace('native-', '')),
            voices: voices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
            disabled: !this.initialized || voices.length === 0,
          }) as TTSVoicesGroup,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  getCapabilities(): TTSCapabilities {
    // Direct-speak engine: the OS renders the audio, so there is no media
    // clock, no word boundaries, and no gap or live-rate control. Preloads
    // are real sentences queued natively, so the controller keeps minutes of
    // upcoming paragraphs requested instead of a fixed handful — that queue
    // is what keeps speech going when the WebView stalls in the background.
    return {
      wordBoundaries: false,
      mediaClock: false,
      gapControl: false,
      liveRateChange: false,
      windowedPrefetch: true,
    };
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId() {
    return this.#currentVoiceId;
  }

  getSpeakingLang() {
    return this.#speakingLang;
  }

  async shutdown() {
    if (this.#eventListener) {
      this.#eventListener.unregister();
      this.#eventListener = null;
    }
    await this.stop();
  }
}
