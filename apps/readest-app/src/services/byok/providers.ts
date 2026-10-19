/**
 * The text-model services a reader can bring their own key for. Every one but
 * Anthropic speaks the OpenAI chat-completions dialect, so "custom" covers any
 * other OpenAI-compatible endpoint too (LM Studio, vLLM, LiteLLM, a proxy…).
 * OpenRouter alone reaches nearly every model there is with one key.
 */
export type TextProviderId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'ollama'
  | 'custom';

export interface TextProvider {
  id: TextProviderId;
  label: string;
  // OpenAI-compatible base URL (".../v1"); for Anthropic its own API root.
  baseUrl: string;
  dialect: 'openai' | 'anthropic';
  needsKey: boolean;
  // Where to get a key, shown beside the field.
  keyUrl?: string;
  // A model to start from; the user can pick any other.
  suggestedModel?: string;
}

export const TEXT_PROVIDERS: TextProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (any model)',
    baseUrl: 'https://openrouter.ai/api/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    suggestedModel: 'deepseek/deepseek-v4.1-flash',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    dialect: 'anthropic',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    suggestedModel: 'deepseek-flash',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    dialect: 'openai',
    needsKey: true,
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (on this computer)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    dialect: 'openai',
    needsKey: false,
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible',
    baseUrl: '',
    dialect: 'openai',
    needsKey: false,
  },
];

export const getTextProvider = (id: TextProviderId): TextProvider =>
  TEXT_PROVIDERS.find((p) => p.id === id) ?? TEXT_PROVIDERS[0]!;
