import { getAIFetch } from './utils/httpFetch';

/**
 * One model entry from a user provider's /models listing, with the
 * free/paid signal the Settings → AI provider form shows next to it.
 * Pricing is already converted to $/1M tokens (2 decimals) when the
 * endpoint reports per-token prices (OpenRouter shape).
 */
export interface CustomProviderModelInfo {
  id: string;
  name?: string;
  pricing?: { input?: string; output?: string };
  isFree: boolean;
}

export interface CustomProviderRef {
  type: 'openai' | 'google' | 'claude';
  baseUrl: string;
  apiKey: string;
}

/** OpenRouter reports $/token; the UI shows $/1M tokens. */
const toPerMillion = (perToken: string | number | undefined): string | undefined => {
  if (perToken === undefined || perToken === null) return undefined;
  const n = typeof perToken === 'string' ? parseFloat(perToken) : perToken;
  if (!Number.isFinite(n)) return undefined;
  return (n * 1e6).toFixed(2);
};

const toNumber = (value: string | number | undefined): number => {
  if (value === undefined) return NaN;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : NaN;
};

interface OpenAIModelEntry {
  id?: string;
  name?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
}

const parseOpenAICompatibleModels = (json: unknown): CustomProviderModelInfo[] => {
  const data = (json as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  return (data as OpenAIModelEntry[])
    .map((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : '';
      const prompt = toNumber(entry.pricing?.prompt);
      const completion = toNumber(entry.pricing?.completion);
      const hasPricing = Number.isFinite(prompt) && Number.isFinite(completion);
      const input = toPerMillion(entry.pricing?.prompt);
      const output = toPerMillion(entry.pricing?.completion);
      return {
        id,
        name: entry.name,
        pricing:
          input !== undefined || output !== undefined ? { input, output } : undefined,
        // OpenRouter marks free models with a ':free' suffix; other
        // endpoints report $0 prompt + completion pricing for free models.
        isFree: id.endsWith(':free') || (hasPricing && prompt === 0 && completion === 0),
      } as CustomProviderModelInfo;
    })
    .filter((m) => m.id);
};

interface ClaudeModelEntry {
  id?: string;
  display_name?: string;
}

const parseClaudeModels = (json: unknown): CustomProviderModelInfo[] => {
  const data = (json as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  return (data as ClaudeModelEntry[])
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      name: entry.display_name,
      // Anthropic's /v1/models carries no pricing; every model is paid.
      isFree: false,
    }))
    .filter((m) => m.id);
};

/**
 * Fetch the model list for a user-added AI provider (Settings → AI →
 * Providers). 'openai' and 'google' speak the OpenAI-compatible /models
 * shape (Google through its OpenAI-compatible endpoint); 'claude' uses
 * Anthropic's /v1/models. Goes through {@link getAIFetch} so Tauri builds
 * bypass the renderer's CORS sandbox, like the other AI calls.
 */
export async function fetchCustomProviderModels(
  provider: CustomProviderRef,
): Promise<CustomProviderModelInfo[]> {
  const httpFetch = getAIFetch();
  if (provider.type === 'claude') {
    const response = await httpFetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    return parseClaudeModels(await response.json());
  }
  const base = (provider.baseUrl || '').replace(/\/+$/, '');
  const response = await httpFetch(`${base}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  return parseOpenAICompatibleModels(await response.json());
}
