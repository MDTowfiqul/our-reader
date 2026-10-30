import { generateText } from 'ai';
import { OpenRouterProvider } from './providers/OpenRouterProvider';
import type { AISettings, CustomAIProvider } from './types';
import { getAIFetch } from './utils/httpFetch';

/**
 * User-added AI providers (Settings → AI → Providers) for Our Reader's
 * summaries and book chat. 'openai' and 'google' speak the OpenAI
 * chat-completions shape (Google through its OpenAI-compatible endpoint);
 * 'claude' speaks Anthropic's messages API. Keys are the user's own, sent
 * only to the endpoint they typed — never anywhere else.
 */

export const DEFAULT_GEMINI_PROVIDER: CustomAIProvider = {
  id: 'gemini-default',
  type: 'google',
  name: 'Gemini',
  apiKey: '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiPath: '/chat/completions',
  model: 'gemini-2.5-flash',
  enabled: true,
};

/** Stored list, or the seeded Gemini entry when the user has never saved one. */
export function getCustomProviders(settings: AISettings): CustomAIProvider[] {
  const stored = settings.customProviders;
  if (stored && stored.length > 0) return stored;
  return [DEFAULT_GEMINI_PROVIDER];
}

/** The provider the user picked for AI features, regardless of key state. */
export function getActiveCustomProvider(settings: AISettings): CustomAIProvider | null {
  const providers = getCustomProviders(settings);
  const activeId = settings.activeCustomProviderId;
  const active = activeId ? providers.find((p) => p.id === activeId) : undefined;
  if (active) return active;
  return providers.find((p) => p.enabled) ?? null;
}

/** True when the active custom provider has a key and can actually be called. */
export function hasCustomProviderKey(settings: AISettings): boolean {
  const active = getActiveCustomProvider(settings);
  return !!active && active.enabled && active.apiKey.trim().length > 0;
}

/** True when ANY AI key exists: a custom provider key or the OpenRouter key. */
export function hasAnyAIKey(settings: AISettings): boolean {
  return hasCustomProviderKey(settings) || !!settings.openrouterApiKey?.trim();
}

/** Cache/route fingerprint so summaries are not shared across providers. */
export function summaryRouteId(settings: AISettings): string {
  const active = getActiveCustomProvider(settings);
  if (active && active.enabled && active.apiKey.trim()) return `custom:${active.id}`;
  return 'openrouter';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function joinUrl(baseUrl: string, apiPath: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${path}`;
}

function extractOpenAIContent(json: unknown): string {
  const choices = (json as { choices?: { message?: { content?: unknown } }[] }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null ? ((part as { text?: string }).text ?? '') : '',
      )
      .join('')
      .trim();
  }
  return '';
}

function extractClaudeContent(json: unknown): string {
  const blocks = (json as { content?: { type?: string; text?: string }[] }).content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

/** One chat-completions (or Claude messages) call against a user provider. */
export async function chatWithCustomProvider(
  provider: CustomAIProvider,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!provider.apiKey.trim()) throw new Error('CUSTOM_PROVIDER_KEY_MISSING');
  const httpFetch = getAIFetch();
  const url = joinUrl(provider.baseUrl, provider.apiPath);
  if (provider.type === 'claude') {
    const response = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 4096,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!response.ok) throw new Error(`AI provider error: ${response.status}`);
    const text = extractClaudeContent(await response.json());
    if (!text) throw new Error('AI provider returned an empty response');
    return text;
  }
  const response = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!response.ok) throw new Error(`AI provider error: ${response.status}`);
  const text = extractOpenAIContent(await response.json());
  if (!text) throw new Error('AI provider returned an empty response');
  return text;
}

/**
 * Route one AI call: the user's selected custom provider when it has a
 * key, otherwise the existing OpenRouter path (unchanged). Throws
 * OPENROUTER_KEY_MISSING when neither key exists, matching summaryService.
 */
export async function chatWithAI(
  settings: AISettings,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  const active = getActiveCustomProvider(settings);
  if (active && active.enabled) {
    return chatWithCustomProvider(active, system, messages);
  }
  if (!settings.openrouterApiKey) {
    throw new Error('OPENROUTER_KEY_MISSING');
  }
  const provider = new OpenRouterProvider({ ...settings, provider: 'openrouter' });
  const prompt = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const { text } = await generateText({ model: provider.getModel(), system, prompt });
  return text.trim();
}
