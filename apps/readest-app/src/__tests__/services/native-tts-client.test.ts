import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));

// Avoid pulling in the heavy TTSController module graph (foliate-js, etc.) — the
// native client only references it as a type.
vi.mock('@/services/tts/TTSController', () => ({ TTSController: class {} }));

import { NativeTTSClient } from '@/services/tts/NativeTTSClient';
import { invoke, addPluginListener } from '@tauri-apps/api/core';
import type { TTSController } from '@/services/tts/TTSController';
import type { TTSMark } from '@/services/tts/types';

describe('NativeTTSClient.stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves promptly when the native stop resolves', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const client = new NativeTTSClient();

    await client.stop();

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|stop');
  });

  test('still resolves (bounded) when the native stop never resolves', async () => {
    // Regression for #4676: a hung native stop must not hang teardown
    // (controller.stop / shutdown), which would leave the TTS icon stuck.
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    const client = new NativeTTSClient();

    let settled = false;
    const p = client.stop().then(() => {
      settled = true;
    });

    // Pending until the timeout fires.
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(settled).toBe(true);
  });
});

describe('NativeTTSClient preload (background queue)', () => {
  const makeMark = (name: string, text = 'Hello world'): TTSMark => ({
    offset: 0,
    name,
    text,
    language: 'en',
  });
  const androidController = {
    appService: { isAndroidApp: true, isIOSApp: false },
  } as unknown as TTSController;
  const iosController = {
    appService: { isAndroidApp: false, isIOSApp: true },
  } as unknown as TTSController;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    let utteranceCount = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:native-tts|init') return { success: true };
      if (cmd === 'plugin:native-tts|get_all_voices') return { voices: [] };
      if (cmd === 'plugin:native-tts|speak') return { utteranceId: `u${++utteranceCount}` };
      return undefined;
    });
  });

  const listenerCallback = () => {
    const calls = vi.mocked(addPluginListener).mock.calls;
    return calls[0]?.[2] as ((event: unknown) => void) | undefined;
  };

  const drain = async <T>(iter: AsyncIterable<T>): Promise<T[]> => {
    const out: T[] = [];
    for await (const ev of iter) out.push(ev);
    return out;
  };

  const speakCalls = () =>
    vi.mocked(invoke).mock.calls.filter((call) => call[0] === 'plugin:native-tts|speak');

  test('preload queues the sentence natively and returns without waiting for speech', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();

    const events = await drain(
      client.speakMark(makeMark('m1'), true, new AbortController().signal),
    );

    expect(events).toEqual([]);
    expect(speakCalls()).toHaveLength(1);
    expect(speakCalls()[0]).toEqual([
      'plugin:native-tts|speak',
      { payload: { text: 'Hello world', preload: true } },
    ]);
  });

  test('a second preload of the same mark does not invoke speak again', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;

    await drain(client.speakMark(makeMark('m1'), true, signal));
    await drain(client.speakMark(makeMark('m1'), true, signal));

    expect(speakCalls()).toHaveLength(1);
  });

  test('live speak of a queued mark attaches without a second invoke and yields its end', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;
    await drain(client.speakMark(makeMark('m1'), true, signal));

    const livePromise = drain(client.speakMark(makeMark('m1'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u1', code: 'end' });
    const events = await livePromise;

    expect(speakCalls()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: 'end', mark: 'm1' });
  });

  test('live speak of an unqueued mark invokes speak with preload:false', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;

    const livePromise = drain(client.speakMark(makeMark('m1'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u1', code: 'end' });
    await livePromise;

    expect(speakCalls()).toEqual([
      ['plugin:native-tts|speak', { payload: { text: 'Hello world', preload: false } }],
    ]);
  });

  test('live speak of an unqueued mark flushes previously queued marks on Android', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;
    await drain(client.speakMark(makeMark('m1', 'First sentence'), true, signal));
    await drain(client.speakMark(makeMark('m2', 'Second sentence'), true, signal));

    // m3 was never preloaded: the fresh live speak flushes the service queue,
    // so m1/m2 are gone with it.
    const livePromise = drain(client.speakMark(makeMark('m3', 'Third sentence'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u3', code: 'end' });
    await livePromise;

    // A later live speak of m1 must invoke fresh (u4), not attach to the
    // flushed u1.
    const replayPromise = drain(client.speakMark(makeMark('m1', 'First sentence'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u4', code: 'end' });
    await replayPromise;
    expect(speakCalls()).toHaveLength(4);
    expect(speakCalls()[3]).toEqual([
      'plugin:native-tts|speak',
      { payload: { text: 'First sentence', preload: false } },
    ]);
  });

  test('handover stop on Android keeps queued marks so the next live speak attaches', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;
    await drain(client.speakMark(makeMark('m1'), true, signal));

    await client.stop(true);

    // A handover is a no-op on Android: the service is already speaking the
    // next paragraph's queued audio, and cutting it would skip its first
    // sentence.
    const stopCalls = vi
      .mocked(invoke)
      .mock.calls.filter((call) => call[0] === 'plugin:native-tts|stop');
    expect(stopCalls).toHaveLength(0);
    const livePromise = drain(client.speakMark(makeMark('m1'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u1', code: 'end' });
    await livePromise;
    expect(speakCalls()).toHaveLength(1);
  });

  test('real stop clears queued marks so the next live speak invokes fresh', async () => {
    const client = new NativeTTSClient(androidController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;
    await drain(client.speakMark(makeMark('m1'), true, signal));

    await client.stop();

    const livePromise = drain(client.speakMark(makeMark('m1'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u2', code: 'end' });
    await livePromise;
    expect(speakCalls()).toHaveLength(2);
  });

  test('handover stop on iOS clears queued marks (the synthesizer queue is flushed)', async () => {
    const client = new NativeTTSClient(iosController);
    await client.init();
    await flush();
    const signal = new AbortController().signal;
    await drain(client.speakMark(makeMark('m1'), true, signal));

    await client.stop(true);

    const livePromise = drain(client.speakMark(makeMark('m1'), false, signal));
    await flush();
    listenerCallback()!({ utteranceId: 'u2', code: 'end' });
    await livePromise;
    expect(speakCalls()).toHaveLength(2);
  });

  test('windowedPrefetch is true so the controller keeps minutes of audio queued', () => {
    const client = new NativeTTSClient(androidController);
    expect(client.getCapabilities().windowedPrefetch).toBe(true);
  });
});

describe('NativeTTSClient voice filtering', () => {
  test('excludes Apple novelty and Eloquence voices, retaining normal and non-Apple voices', async () => {
    const voices = [
      { id: 'com.apple.speech.synthesis.voice.BadNews', name: 'Bad News', lang: 'en-US' },
      { id: 'com.apple.eloquence.en-US.Eddy', name: 'Eddy (United States)', lang: 'en-US' },
      { id: 'com.apple.voice.super-compact.en-US.Samantha', name: 'Samantha', lang: 'en-US' },
      { id: 'com.apple.voice.enhanced.en-US.Samantha', name: 'Samantha (Enhanced)', lang: 'en-US' },
      { id: 'com.apple.ttsbundle.siri_Aaron_en-US_compact', name: 'Aaron', lang: 'en-US' },
      { id: 'android-voice-1', name: 'Eddy', lang: 'en-US' },
    ];
    vi.mocked(invoke).mockResolvedValue({ voices });
    const client = new NativeTTSClient();
    expect((await client.getAllVoices()).map((voice) => voice.id)).toEqual(
      voices.slice(2).map((voice) => voice.id),
    );
    const groups = await client.getVoices('en');
    expect(groups.flatMap((group) => group.voices)).toHaveLength(4);
  });
});
