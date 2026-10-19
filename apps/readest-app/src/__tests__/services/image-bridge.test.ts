import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_AI_CONFIG, useAIConfigStore } from '@/services/byok/aiConfig';
import { generateImage, imageRoute, imageStatus } from '@/services/imageBridge';

const fetchMock = vi.fn();

describe('image bridge client (phones)', () => {
  test('a copy that is neither the desktop nor the web app uses the bridge', () => {
    expect(imageRoute()).toBe('bridge');
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useAIConfigStore.setState({ config: { ...DEFAULT_AI_CONFIG, phonePictures: 'computer' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  test('asks the bridge for a picture from the chosen provider', async () => {
    useAIConfigStore.setState({
      config: {
        ...DEFAULT_AI_CONFIG,
        imageProvider: 'imagine',
        bridgeToken: 't',
        phonePictures: 'computer',
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mimeType: 'image/jpeg', data: 'AAAA' }),
    });

    expect(await generateImage('a lighthouse', '4:3')).toBe('data:image/jpeg;base64,AAAA');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7531/generate');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer t');
    expect(JSON.parse(init.body)).toEqual({
      provider: 'imagine',
      prompt: 'a lighthouse',
      aspect: '4:3',
    });
  });

  test('passes on what went wrong in Flow', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'POLICY: Flow refused the picture' }),
    });
    await expect(generateImage('x')).rejects.toThrow('POLICY: Flow refused the picture');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).provider).toBe('flow');
  });

  test('says how to start the bridge when it is not running', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(imageStatus()).rejects.toThrow(/Start the image bridge/);
  });
});
