import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  chatWithCustomProvider,
  getActiveCustomProvider,
  getCustomProviders,
  hasAnyAIKey,
} from '@/services/ai/customProviders';
import type { AISettings, CustomAIProvider } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const openaiProvider: CustomAIProvider = {
  id: 'p1',
  type: 'openai',
  name: 'My OpenAI',
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  apiPath: '/chat/completions',
  model: 'gpt-4o-mini',
  enabled: true,
};

describe('custom providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('seeded Gemini entry is the default provider list', () => {
    const providers = getCustomProviders({ ...DEFAULT_AI_SETTINGS, customProviders: undefined });
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Gemini');
    expect(providers[0]!.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(providers[0]!.apiKey).toBe('');
  });

  test('active provider is the selected one, and a keyless one reports no key', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS };
    expect(getActiveCustomProvider(settings)?.name).toBe('Gemini');
    expect(hasAnyAIKey(settings)).toBe(false);
    const withKey: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      customProviders: [{ ...openaiProvider }],
      activeCustomProviderId: 'p1',
    };
    expect(hasAnyAIKey(withKey)).toBe(true);
  });

  test('OpenAI-shaped call posts chat completions with a Bearer key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from the book' } }] }),
    });
    const text = await chatWithCustomProvider(openaiProvider, 'You are the book.', [
      { role: 'user', content: 'What happens?' },
    ]);
    expect(text).toBe('Hello from the book');
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are the book.' });
  });

  test('Claude call uses the messages API shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Claude answer' }] }),
    });
    const claude: CustomAIProvider = {
      ...openaiProvider,
      id: 'p2',
      type: 'claude',
      name: 'Claude',
      baseUrl: 'https://api.anthropic.com',
      apiPath: '/v1/messages',
      model: 'claude-sonnet-4-5',
    };
    const text = await chatWithCustomProvider(claude, 'sys', [{ role: 'user', content: 'hi' }]);
    expect(text).toBe('Claude answer');
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.system).toBe('sys');
  });

  test('keyless provider throws instead of calling the network', async () => {
    await expect(
      chatWithCustomProvider({ ...openaiProvider, apiKey: '' }, 'sys', [
        { role: 'user', content: 'hi' },
      ]),
    ).rejects.toThrow('CUSTOM_PROVIDER_KEY_MISSING');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
