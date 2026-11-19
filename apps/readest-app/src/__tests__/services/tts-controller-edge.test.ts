import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { TTSVoice } from '@/services/tts/types';
import { FoliateView } from '@/types/view';

// Task 2: the controller must probe the Edge client in init(), list its
// voices in the picker, and switch to it when one of its voices is picked.
// Harness mirrors tts-controller-lifecycle.test.ts.

// Mutable per-test Edge behavior.
let edgeInitResult = true;
let edgeVoices: TTSVoice[] = [
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB' },
];

const makeMockClient = (name: string): TTSClient => ({
  name,
  initialized: true,
  init: vi.fn().mockResolvedValue(true),
  shutdown: vi.fn().mockResolvedValue(undefined),
  speak: vi.fn().mockImplementation(async function* (): AsyncIterable<TTSMessageEvent> {
    yield { code: 'end', message: 'done' };
  }),
  pause: vi.fn().mockResolvedValue(true),
  resume: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
  setPrimaryLang: vi.fn(),
  setRate: vi.fn().mockResolvedValue(undefined),
  setPitch: vi.fn().mockResolvedValue(undefined),
  setVoice: vi.fn().mockResolvedValue(undefined),
  getAllVoices: vi.fn().mockResolvedValue([]),
  getVoices: vi.fn().mockResolvedValue([]),
  getGranularities: vi.fn().mockReturnValue(['sentence']),
  getCapabilities: vi.fn().mockReturnValue({
    wordBoundaries: false,
    mediaClock: false,
    gapControl: false,
    liveRateChange: false,
  }),
  getVoiceId: vi.fn().mockReturnValue('mock-voice'),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  // constants.ts imports this named const from the same module; the mock
  // factory replaces the whole module, so it must re-export it too.
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    const inst = makeMockClient('edge-tts');
    inst.init = vi.fn().mockImplementation(async function (this: Record<string, unknown>) {
      this.initialized = edgeInitResult;
      return edgeInitResult;
    });
    inst.getAllVoices = vi.fn().mockImplementation(async () => (edgeInitResult ? edgeVoices : []));
    inst.getVoices = vi
      .fn()
      .mockImplementation(async () =>
        edgeInitResult ? [{ id: 'edge-tts', name: 'Edge TTS', voices: edgeVoices }] : [],
      );
    inst.getCapabilities = vi.fn().mockReturnValue({
      wordBoundaries: true,
      mediaClock: true,
      gapControl: true,
      liveRateChange: false,
    });
    Object.assign(this, inst);
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('native'));
  }),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));
vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      start: vi.fn().mockReturnValue('<speak>hello</speak>'),
      resume: vi.fn().mockReturnValue('<speak>hello</speak>'),
      next: vi.fn().mockReturnValue(undefined),
      prev: vi.fn().mockReturnValue(undefined),
      from: vi.fn().mockReturnValue('<speak>from</speak>'),
      setMark: vi.fn().mockReturnValue(undefined),
      getLastRange: vi.fn().mockReturnValue(undefined),
      doc: null,
    });
  }),
  getSentences: vi.fn().mockImplementation(function* () {}),
}));
vi.mock('foliate-js/text-walker.js', () => ({ textWalker: vi.fn() }));
vi.mock('@/utils/ssml', () => ({
  filterSSMLWithLang: vi.fn((ssml: string) => ssml),
  parseSSMLMarks: vi.fn(() => ({
    plainText: 'hello',
    marks: [{ offset: 0, name: '0', text: 'hello', language: 'en' }],
  })),
}));
vi.mock('@/utils/node', () => ({ createRejectFilter: vi.fn(() => () => 1) }));
vi.mock('@/utils/lang', () => ({
  isValidLang: vi.fn(() => true),
  isCJKLang: vi.fn(() => false),
}));

const makeView = (): FoliateView => {
  const doc = document.implementation.createHTMLDocument('t');
  return {
    book: { sections: [{ createDocument: vi.fn().mockResolvedValue(doc) }] },
    renderer: {
      getContents: () => [{ doc, index: 0, overlayer: { add: vi.fn(), remove: vi.fn() } }],
      primaryIndex: 0,
    },
    language: { isCJK: false },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => new Range() }),
    tts: null,
  } as unknown as FoliateView;
};

describe('TTSController Edge re-enable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    edgeInitResult = true;
    edgeVoices = [
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB' },
    ];
  });

  test('Edge init fails: init still finishes, web client stays, no Edge voices listed', async () => {
    edgeInitResult = false;
    const controller = new TTSController(null, makeView());
    await controller.init();
    expect(controller.ttsClient.name).toBe('web-speech');
    expect(controller.ttsEdgeVoices).toEqual([]);
    const groups = await controller.getVoices('en');
    expect(groups.some((group) => group.id === 'edge-tts')).toBe(false);
  });

  test('Edge init succeeds: Edge voices are listed in the picker', async () => {
    edgeInitResult = true;
    const controller = new TTSController(null, makeView());
    await controller.init();
    expect(controller.ttsEdgeVoices).toEqual(edgeVoices);
    const groups = await controller.getVoices('en');
    const edgeGroup = groups.find((group) => group.id === 'edge-tts');
    expect(edgeGroup).toBeDefined();
    expect(edgeGroup!.voices).toEqual(edgeVoices);
  });

  test('picking an Edge voice switches the client to Edge', async () => {
    edgeInitResult = true;
    const controller = new TTSController(null, makeView());
    await controller.init();
    await controller.setVoice('en-US-AriaNeural', 'en-US');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });
});
