/**
 * Pictures (mind maps, visuals, comics, feed cards) come from Google Flow or
 * Grok Imagine — the reader's choice — made in a real browser window where
 * the reader is signed in. The app doesn't drive that browser itself: the
 * image bridge does (tools/image-bridge, `node bridge.mjs`), on this computer
 * or on one the phone can reach. The same bridge is an MCP server for agents.
 */
import { getAIFetch } from '@/services/ai/utils/httpFetch';

import { getAIConfig, type ImageProviderId } from './byok/aiConfig';

export type ImageAspect = '16:9' | '9:16' | '4:3' | '3:4' | '1:1';
export type ProviderState = 'closed' | 'signin' | 'ready';

export const IMAGE_PROVIDER_LABELS: Record<ImageProviderId, string> = {
  flow: 'Google Flow',
  imagine: 'Grok Imagine',
};

const BRIDGE_DOWN =
  'The image bridge is not running. Start it on your computer with `node tools/image-bridge/bridge.mjs`, then try again.';

async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const { bridgeUrl, bridgeToken } = getAIConfig();
  let response: Response;
  try {
    response = await getAIFetch()(`${bridgeUrl.replace(/\/+$/, '')}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init ? { 'Content-Type': 'application/json' } : {}),
        ...(bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}),
      },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new Error(BRIDGE_DOWN);
  }
  const reply = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(reply.error || `Image bridge ${response.status}`);
  return reply;
}

/** Each provider's window: closed, waiting for sign-in, or ready. */
export const bridgeStatus = () => call<Record<ImageProviderId, ProviderState>>('/status');

/** Open the provider's browser window, to sign in. */
export const openImageProvider = (provider: ImageProviderId = getAIConfig().imageProvider) =>
  call<{ ok: boolean }>('/open', { method: 'POST', body: { provider } });

/** Make one picture with the chosen provider; resolves to a data: URL. */
export async function generateImage(prompt: string, aspect: ImageAspect = '16:9'): Promise<string> {
  const provider = getAIConfig().imageProvider;
  const { mimeType, data } = await call<{ mimeType: string; data: string }>('/generate', {
    method: 'POST',
    body: { provider, prompt, aspect },
  });
  if (!data) throw new Error(`${IMAGE_PROVIDER_LABELS[provider]} returned no picture`);
  return `data:${mimeType || 'image/png'};base64,${data}`;
}
