import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_AI_CONFIG, useAIConfigStore, type AIConfig } from '@/services/byok/aiConfig';
import { chatImage, chatJson, chatText, listModels, parseJsonReply } from '@/services/llm';

const fetchMock = vi.fn();

const ok = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const setup = (patch: Partial<AIConfig>) =>
  useAIConfigStore.setState({ config: { ...DEFAULT_AI_CONFIG, ...patch } });

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

describe('llm client (bring your own key)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  test('refuses to run until a key and model are set, without calling out', async () => {
    setup({ textProvider: 'openai' });
    await expect(chatText([{ role: 'user', content: 'hi' }])).rejects.toThrow(/AI is not set up/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('calls the chosen OpenAI-compatible service with the reader’s key and model', async () => {
    setup({ textProvider: 'xai', apiKeys: { xai: 'xk' }, models: { xai: 'grok-x' } });
    fetchMock.mockResolvedValueOnce(ok(' hello '));

    const reply = await chatText([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello!' },
    ]);

    expect(reply).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer xk');
    expect(lastBody()).toMatchObject({
      model: 'grok-x',
      stream: false,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hello!' },
      ],
    });
  });

  test('a custom endpoint uses its own address, and no key when none is given', async () => {
    setup({
      textProvider: 'custom',
      baseUrls: { custom: 'http://localhost:1234/v1/' },
      models: { custom: 'local-model' },
    });
    fetchMock.mockResolvedValueOnce(ok('x'));

    await chatText([{ role: 'user', content: 'hi' }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init.headers.Authorization).toBeUndefined();
  });

  // deepseek-flash thinks by default: ~7k hidden tokens a chapter, ~4x the cost.
  test('turns thinking off in each service’s own words', async () => {
    setup({ textProvider: 'deepseek', apiKeys: { deepseek: 'k' } });
    fetchMock.mockResolvedValue(ok('{}'));
    await chatJson('give json');
    expect(lastBody()).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });

    setup({ textProvider: 'openrouter', apiKeys: { openrouter: 'k' } });
    await chatText([{ role: 'user', content: 'hi' }]);
    expect(lastBody().reasoning).toEqual({ enabled: false });

    setup({ textProvider: 'openrouter', apiKeys: { openrouter: 'k' }, disableThinking: false });
    await chatText([{ role: 'user', content: 'hi' }]);
    expect(lastBody().reasoning).toBeUndefined();
  });

  test('retries once without the extras when the service rejects them', async () => {
    setup({ textProvider: 'groq', apiKeys: { groq: 'k' }, models: { groq: 'm' } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'max_tokens is too large' } }),
    });
    fetchMock.mockResolvedValueOnce(ok('{"a":1}'));

    expect(await chatJson('give json', { maxTokens: 32768 })).toEqual({ a: 1 });

    const first = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(first.max_tokens).toBe(32768);
    expect(first.response_format).toEqual({ type: 'json_object' });
    expect(lastBody().max_tokens).toBeUndefined();
    expect(lastBody().response_format).toBeUndefined();
  });

  test('OpenAI gets max_completion_tokens', async () => {
    setup({ textProvider: 'openai', apiKeys: { openai: 'k' }, models: { openai: 'gpt' } });
    fetchMock.mockResolvedValueOnce(ok('{}'));
    await chatJson('give json', { maxTokens: 1000 });
    expect(lastBody().max_completion_tokens).toBe(1000);
    expect(lastBody().max_tokens).toBeUndefined();
  });

  test('speaks Anthropic’s Messages API, images included', async () => {
    setup({
      textProvider: 'anthropic',
      apiKeys: { anthropic: 'ak' },
      models: { anthropic: 'claude' },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: ' page text ' }] }),
    });

    expect(await chatImage('transcribe', 'data:image/jpeg;base64,AAAA')).toBe('page text');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('ak');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(lastBody()).toEqual({
      model: 'claude',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'transcribe' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          ],
        },
      ],
    });
  });

  test('surfaces the service’s error with the model and provider', async () => {
    setup({
      textProvider: 'openrouter',
      apiKeys: { openrouter: 'k' },
      models: { openrouter: 'x/y' },
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({ error: { message: 'Insufficient credits' } }),
    });
    await expect(chatText([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'x/y (openrouter) 402: Insufficient credits',
    );
  });

  test('lists models, without Gemini’s "models/" prefix', async () => {
    setup({ textProvider: 'google', apiKeys: { google: 'g' } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'models/gemini-b' }, { id: 'models/gemini-a' }] }),
    });
    expect(await listModels()).toEqual(['gemini-a', 'gemini-b']);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
    );
  });
});

describe('parseJsonReply', () => {
  test('strips a markdown code fence', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('finds the object inside prose', () => {
    expect(parseJsonReply('Here you go: {"a":1} Enjoy!')).toEqual({ a: 1 });
  });

  test('throws on text that is not JSON', () => {
    expect(() => parseJsonReply('sorry, I cannot')).toThrow();
  });
});
