/**
 * Text client for ShortReader's own AI features (AI Insights, the curated
 * feed, the audio story, OCR of scanned pages), on whatever service and model
 * the reader chose in Settings → AI keys, with their own key.
 *
 * Two dialects cover every service: OpenAI chat completions (OpenAI,
 * OpenRouter, Gemini, xAI, DeepSeek, Groq, Mistral, Together, Ollama, any
 * compatible endpoint) and Anthropic's Messages API.
 *
 * Services differ in what they accept — JSON mode, a "don't think" switch,
 * how many reply tokens — so a request first asks for everything that helps,
 * and if the service rejects it as a bad request (400/422), once more with
 * only what every service takes. Replies are parsed leniently for the same
 * reason: JSON mode is a request, not a guarantee.
 */
import { getAIFetch } from '@/services/ai/utils/httpFetch';

import { resolveTextConfig, textConfigProblem, type ResolvedTextConfig } from './byok/aiConfig';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface CompletionOptions {
  // A cap on the reply. Services that allow less get their own maximum.
  maxTokens?: number;
}

// Anthropic requires a cap; this is within every current Claude model's.
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

class RequestRejected extends Error {}

const errorMessage = (reply: unknown): string => {
  const r = reply as { error?: { message?: string } | string; message?: string };
  if (typeof r?.error === 'string') return r.error;
  return r?.error?.message || r?.message || 'request failed';
};

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await getAIFetch()(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const reply = await response.json().catch(() => ({}));
  if (response.status === 400 || response.status === 422) {
    throw new RequestRejected(`${response.status}: ${errorMessage(reply)}`);
  }
  if (!response.ok) throw new Error(`${response.status}: ${errorMessage(reply)}`);
  return reply;
}

/** Same request again without the optional extras, when the service refused them. */
async function withFallback<T>(full: () => Promise<T>, plain: () => Promise<T>): Promise<T> {
  try {
    return await full();
  } catch (e) {
    if (e instanceof RequestRejected) return plain();
    throw e;
  }
}

// ---- OpenAI dialect --------------------------------------------------------------

// Each service's way of saying "answer straight away, don't reason first".
const noThinking = (c: ResolvedTextConfig): Record<string, unknown> => {
  switch (c.provider) {
    case 'deepseek':
      return { thinking: { type: 'disabled' } };
    case 'openrouter':
      return { reasoning: { enabled: false } };
    case 'google':
      return { reasoning_effort: 'none' };
    default:
      return {};
  }
};

async function completeOpenAI(
  c: ResolvedTextConfig,
  messages: ChatMessage[],
  json: boolean,
  { maxTokens }: CompletionOptions,
): Promise<string> {
  const headers: Record<string, string> = c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {};
  if (c.provider === 'openrouter') headers['X-Title'] = 'ShortReader';
  const base = { model: c.model, messages, stream: false };
  // OpenAI's newer models take only max_completion_tokens.
  const cap = maxTokens
    ? c.provider === 'openai'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }
    : {};
  const send = (body: Record<string, unknown>) =>
    post(`${c.baseUrl}/chat/completions`, headers, body) as Promise<{
      choices?: { message?: { content?: string | null } }[];
    }>;
  const reply = await withFallback(
    () =>
      send({
        ...base,
        ...cap,
        ...(c.disableThinking ? noThinking(c) : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    () => send(base),
  );
  return (reply.choices?.[0]?.message?.content || '').trim();
}

// ---- Anthropic dialect -----------------------------------------------------------

type AnthropicPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

const toAnthropicContent = (content: ChatMessage['content']): string | AnthropicPart[] => {
  if (typeof content === 'string') return content;
  return content.map((part): AnthropicPart => {
    if (part.type === 'text') return part;
    const [, mediaType = 'image/png', data = ''] =
      part.image_url.url.match(/^data:([^;]+);base64,(.*)$/s) ?? [];
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  });
};

async function completeAnthropic(
  c: ResolvedTextConfig,
  messages: ChatMessage[],
  { maxTokens }: CompletionOptions,
): Promise<string> {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n\n');
  const body = {
    model: c.model,
    ...(system ? { system } : {}),
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
  };
  const headers = {
    'x-api-key': c.apiKey,
    'anthropic-version': '2023-06-01',
    // The app calls Anthropic from the reader's device with the reader's key.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const send = (max: number) =>
    post(`${c.baseUrl}/messages`, headers, { ...body, max_tokens: max }) as Promise<{
      content?: { type: string; text?: string }[];
    }>;
  const reply = await withFallback(
    () => send(maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS),
    () => send(ANTHROPIC_DEFAULT_MAX_TOKENS),
  );
  return (reply.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

// ---- Public API ------------------------------------------------------------------

async function complete(
  messages: ChatMessage[],
  json: boolean,
  options: CompletionOptions = {},
): Promise<string> {
  const problem = textConfigProblem();
  if (problem) throw new Error(`AI is not set up: ${problem} (Settings → AI keys)`);
  const c = resolveTextConfig();
  try {
    return c.dialect === 'anthropic'
      ? await completeAnthropic(c, messages, options)
      : await completeOpenAI(c, messages, json, options);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${c.model} (${c.provider}) ${message}`);
  }
}

export const chatText = (messages: ChatMessage[]): Promise<string> => complete(messages, false);

/** A prompt about one image (a base64 data URL), for OCR of scanned pages.
 * Needs a model that reads images. */
export const chatImage = (prompt: string, imageUrl: string): Promise<string> =>
  complete(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    false,
  );

/** Parse a JSON reply, tolerating a markdown fence or prose around it. */
export const parseJsonReply = <T>(text: string): T => {
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced) as T;
  } catch (e) {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1)) as T;
    throw e;
  }
};

/** One-shot prompt whose reply must be a JSON object. The prompt itself has
 * to describe the shape — JSON mode guarantees syntax at best, not schema. */
export const chatJson = async <T>(prompt: string, options?: CompletionOptions): Promise<T> =>
  parseJsonReply<T>(
    await complete(
      [{ role: 'user', content: `${prompt}\n\nReply with the JSON object only.` }],
      true,
      options,
    ),
  );

/** The models the service offers for this key, by id. */
export async function listModels(c: ResolvedTextConfig = resolveTextConfig()): Promise<string[]> {
  const headers: Record<string, string> =
    c.dialect === 'anthropic'
      ? {
          'x-api-key': c.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : c.apiKey
        ? { Authorization: `Bearer ${c.apiKey}` }
        : {};
  const response = await getAIFetch()(`${c.baseUrl}/models`, { headers });
  const reply = (await response.json().catch(() => ({}))) as
    | { data?: { id?: string }[] }
    | { id?: string }[];
  if (!response.ok) throw new Error(`${response.status}: ${errorMessage(reply)}`);
  const list = Array.isArray(reply) ? reply : (reply.data ?? []);
  return [
    ...new Set(
      list
        .map((m) => (m.id ?? '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ),
  ];
}

/** A tiny real request, so the reader knows the key and model work. */
export const testTextModel = async (): Promise<string> =>
  chatText([{ role: 'user', content: 'Reply with the single word: ready' }]);
