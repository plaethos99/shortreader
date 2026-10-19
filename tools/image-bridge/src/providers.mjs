/**
 * The two places pictures come from, behind one shape. The work is done by the
 * app's own image engine (apps/readest-app/src/services/imagegen), which Node
 * runs straight from its TypeScript source, so the app and the bridge drive
 * Flow and Grok Imagine the same way.
 */
import {
  IMAGE_ASPECTS,
  PROVIDER_LABELS,
  makeImage,
  openSite,
  siteState,
} from '../../../apps/readest-app/src/services/imagegen/core.ts';
import { createNodePlatform } from '../../../apps/readest-app/src/services/imagegen/nodePlatform.ts';

export const PROVIDERS = /** @type {const} */ (['flow', 'imagine']);
export const ASPECTS = IMAGE_ASPECTS;

const platform = createNodePlatform();

export const provider = (name) => {
  if (!PROVIDERS.includes(name)) {
    throw new Error(`Unknown image provider "${name}": use ${PROVIDERS.join(' or ')}`);
  }
  return { label: PROVIDER_LABELS[name], open: () => openSite(platform, name) };
};

/** Each provider's state: closed (no window), signin, or ready. */
export const status = async () => ({
  flow: await siteState(platform, 'flow'),
  imagine: await siteState(platform, 'imagine'),
});

/**
 * Make one picture. Opens the provider's window when it isn't open and waits
 * (up to 10 minutes) for the user to sign in there, then makes it.
 */
export const generate = async ({ provider: name, prompt, aspect = '16:9' }, onProgress) => {
  provider(name);
  const image = await makeImage(platform, name, String(prompt ?? ''), aspect, onProgress);
  return { mimeType: image.mimeType, data: Buffer.from(image.data, 'base64') };
};
