/**
 * The reader's own AI setup: which text service and model, their key, and
 * where pictures come from. Nothing ships with the app — every key is the
 * reader's, kept only on this device (localStorage, which the desktop and
 * mobile webviews persist) and sent only to the service it belongs to.
 */
import { create } from 'zustand';

import { getTextProvider, type TextProviderId } from './providers';

export type ImageProviderId = 'flow' | 'imagine';

export interface AIConfig {
  textProvider: TextProviderId;
  // Kept per provider, so switching back and forth loses nothing.
  apiKeys: Partial<Record<TextProviderId, string>>;
  models: Partial<Record<TextProviderId, string>>;
  // Only used by "custom" (and to point Ollama elsewhere).
  baseUrls: Partial<Record<TextProviderId, string>>;
  // Ask reasoning models not to think: much faster and cheaper for the
  // feed's JSON, with no better results. Ignored by models that can't.
  disableThinking: boolean;

  imageProvider: ImageProviderId;
  // Phones only. phone: automatically, in a Flow / Grok window inside the app
  // (Android; iOS falls back to the hand-off). handoff: the reader pastes the
  // prompt in the Flow / Grok app or browser and adds the picture. computer:
  // a computer's image bridge.
  phonePictures: 'phone' | 'handoff' | 'computer';
  // The image bridge (tools/image-bridge) that drives Flow / Grok Imagine.
  bridgeUrl: string;
  bridgeToken: string;
}

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:7531';

export const DEFAULT_AI_CONFIG: AIConfig = {
  textProvider: 'openrouter',
  apiKeys: {},
  models: {},
  baseUrls: {},
  disableThinking: true,
  imageProvider: 'flow',
  phonePictures: 'phone',
  bridgeUrl: DEFAULT_BRIDGE_URL,
  bridgeToken: '',
};

const STORAGE_KEY = 'shortreader.ai-config';

const load = (): AIConfig => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...DEFAULT_AI_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) }
      : DEFAULT_AI_CONFIG;
  } catch {
    return DEFAULT_AI_CONFIG;
  }
};

const save = (config: AIConfig) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Private mode or storage full: the setup lasts for this session only.
  }
};

interface AIConfigState {
  config: AIConfig;
  update: (patch: Partial<AIConfig>) => void;
}

export const useAIConfigStore = create<AIConfigState>((set, get) => ({
  config: load(),
  update: (patch) => {
    const config = { ...get().config, ...patch };
    save(config);
    set({ config });
  },
}));

export const getAIConfig = (): AIConfig => useAIConfigStore.getState().config;

/** What a request to the chosen text service needs. */
export interface ResolvedTextConfig {
  provider: TextProviderId;
  dialect: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  disableThinking: boolean;
}

export const resolveTextConfig = (config: AIConfig = getAIConfig()): ResolvedTextConfig => {
  const provider = getTextProvider(config.textProvider);
  return {
    provider: provider.id,
    dialect: provider.dialect,
    baseUrl: (config.baseUrls[provider.id] || provider.baseUrl).replace(/\/+$/, ''),
    apiKey: (config.apiKeys[provider.id] || '').trim(),
    model: (config.models[provider.id] || provider.suggestedModel || '').trim(),
    disableThinking: config.disableThinking,
  };
};

/** Why the text AI can't run yet, or null when it can. */
export const textConfigProblem = (config: AIConfig = getAIConfig()): string | null => {
  const provider = getTextProvider(config.textProvider);
  const resolved = resolveTextConfig(config);
  if (!resolved.baseUrl) return 'Enter the API address of your AI service.';
  if (provider.needsKey && !resolved.apiKey) return `Add your ${provider.label} API key.`;
  if (!resolved.model) return 'Choose a model.';
  return null;
};

export const isTextAIConfigured = (): boolean => textConfigProblem() === null;
