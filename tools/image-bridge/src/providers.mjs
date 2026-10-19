/** The two places pictures come from, behind one shape. */
import { flowImage, flowState, openFlow } from './flow.mjs';
import { grokImage, grokState, openGrok } from './grok.mjs';

export const PROVIDERS = /** @type {const} */ (['flow', 'imagine']);
export const ASPECTS = /** @type {const} */ (['16:9', '9:16', '4:3', '3:4', '1:1']);

const byName = {
  flow: { label: 'Google Flow', open: openFlow, state: flowState, image: flowImage },
  imagine: { label: 'Grok Imagine', open: openGrok, state: grokState, image: grokImage },
};

export const provider = (name) => {
  const p = byName[name];
  if (!p) throw new Error(`Unknown image provider "${name}": use ${PROVIDERS.join(' or ')}`);
  return p;
};

/** Each provider's state: closed (no window), signin, or ready. */
export const status = async () => ({
  flow: await flowState(),
  imagine: await grokState(),
});

/**
 * Make one picture. Opens the provider's window first when it isn't running,
 * so the user can sign in; the request then fails with a message saying so.
 */
export const generate = async ({ provider: name, prompt, aspect = '16:9' }) => {
  const p = provider(name);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A prompt is needed');
  if (!ASPECTS.includes(aspect)) throw new Error(`Aspect must be one of ${ASPECTS.join(', ')}`);
  if ((await p.state()) === 'closed') {
    await p.open();
    throw new Error(
      `${p.label} was not open. Its window is opening now: sign in there, then try again.`,
    );
  }
  return p.image(prompt.trim(), aspect);
};
