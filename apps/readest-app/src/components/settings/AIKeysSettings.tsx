import React, { useEffect, useState } from 'react';

import {
  DEFAULT_BRIDGE_URL,
  resolveTextConfig,
  textConfigProblem,
  useAIConfigStore,
  type ImageProviderId,
} from '@/services/byok/aiConfig';
import { TEXT_PROVIDERS, getTextProvider, type TextProviderId } from '@/services/byok/providers';
import { listModels, testTextModel } from '@/services/llm';
import { getOSPlatform } from '@/utils/misc';
import {
  IMAGE_PROVIDER_LABELS,
  imageRoute,
  imageStatus,
  openImageProvider,
  type ProviderState,
} from '@/services/imageBridge';
import { BoxedList, SettingsInput, SettingsRow, SettingsSelect, Tips } from './primitives';

type Check = { state: 'idle' | 'busy' | 'ok' | 'info' | 'error'; message?: string };

const STATE_LABEL: Record<ProviderState, string> = {
  closed: 'window closed',
  signin: 'waiting for sign-in',
  ready: 'ready',
};

const CheckLine: React.FC<{ check: Check }> = ({ check }) =>
  check.state === 'idle' ? null : (
    <p
      className={`mt-1 ps-4 text-[0.8em] ${
        check.state === 'error'
          ? 'text-error'
          : check.state === 'ok'
            ? 'text-success'
            : 'text-base-content/65'
      }`}
    >
      {check.state === 'busy' ? 'Checking…' : check.message}
    </p>
  );

/**
 * Bring-your-own-key setup for ShortReader's AI: the text service, key and
 * model, and where pictures come from (Google Flow or Grok Imagine through the
 * image engine). Everything is saved on this device as it is typed.
 */
const AIKeysSettings: React.FC = () => {
  const { config, update } = useAIConfigStore();
  const provider = getTextProvider(config.textProvider);
  const resolved = resolveTextConfig(config);
  const [models, setModels] = useState<string[]>([]);
  const [modelCheck, setModelCheck] = useState<Check>({ state: 'idle' });
  const [textCheck, setTextCheck] = useState<Check>({ state: 'idle' });
  const [bridgeCheck, setBridgeCheck] = useState<Check>({ state: 'idle' });
  const onPhone = imageRoute() === 'bridge';
  // A phone makes pictures itself (in-app window, or the hand-off) unless set
  // to a computer.
  const phoneHandoff = onPhone && config.phonePictures !== 'computer';
  const inAppWindow = onPhone && config.phonePictures === 'phone' && getOSPlatform() === 'android';

  const setFor = (
    field: 'apiKeys' | 'models' | 'baseUrls',
    value: string,
    id: TextProviderId = config.textProvider,
  ) => update({ [field]: { ...config[field], [id]: value } });

  // A new provider has its own model list.
  useEffect(() => {
    setModels([]);
    setModelCheck({ state: 'idle' });
    setTextCheck({ state: 'idle' });
  }, [config.textProvider]);

  const loadModels = async () => {
    setModelCheck({ state: 'busy' });
    try {
      const list = await listModels(resolved);
      setModels(list);
      setModelCheck({
        state: 'ok',
        message: `${list.length} models available — pick one or type any model id.`,
      });
    } catch (e) {
      setModelCheck({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const testText = async () => {
    const problem = textConfigProblem(config);
    if (problem) return setTextCheck({ state: 'error', message: problem });
    setTextCheck({ state: 'busy' });
    try {
      const reply = await testTextModel();
      setTextCheck({
        state: 'ok',
        message: `Works. ${resolved.model} replied: “${reply.slice(0, 60)}”`,
      });
    } catch (e) {
      setTextCheck({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const checkBridge = async () => {
    setBridgeCheck({ state: 'busy' });
    try {
      const status = await imageStatus();
      const mine = status[config.imageProvider];
      setBridgeCheck({
        state: mine === 'ready' ? 'ok' : 'info',
        message: `${IMAGE_PROVIDER_LABELS[config.imageProvider]}: ${STATE_LABEL[mine]}.${
          mine === 'ready'
            ? ''
            : ' Press Open and sign in — or just ask for a picture: the window opens by itself and the picture starts once you are in.'
        }`,
      });
    } catch (e) {
      setBridgeCheck({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const openProvider = async () => {
    setBridgeCheck({ state: 'busy' });
    try {
      await openImageProvider(config.imageProvider);
      setBridgeCheck({
        state: 'ok',
        message: inAppWindow
          ? `${IMAGE_PROVIDER_LABELS[config.imageProvider]} is opening in a window inside ShortReader. Sign in there once; pictures are then made by themselves.`
          : phoneHandoff
            ? `Opening ${IMAGE_PROVIDER_LABELS[config.imageProvider]}. Sign in there once.`
            : `${IMAGE_PROVIDER_LABELS[config.imageProvider]} is opening in its own browser window. Sign in there once; it remembers you.`,
      });
    } catch (e) {
      setBridgeCheck({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <div>
        <BoxedList
          title='Text AI'
          description='Insights, the curated feed, the audio story and reading scanned pages use this model. Your key stays on this device and goes only to the service you pick.'
        >
          <SettingsRow label='Service'>
            <SettingsSelect
              value={config.textProvider}
              onChange={(e) => update({ textProvider: e.target.value as TextProviderId })}
              options={TEXT_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
              ariaLabel='AI service'
            />
          </SettingsRow>
          {(provider.id === 'custom' || provider.id === 'ollama') && (
            <SettingsRow label='API address'>
              <SettingsInput
                type='url'
                value={config.baseUrls[provider.id] ?? provider.baseUrl}
                placeholder='https://example.com/v1'
                onChange={(e) => setFor('baseUrls', e.target.value)}
              />
            </SettingsRow>
          )}
          <SettingsRow
            label='API key'
            description={
              provider.keyUrl ? (
                <a className='link' href={provider.keyUrl} target='_blank' rel='noreferrer'>
                  Get a key
                </a>
              ) : provider.needsKey ? undefined : (
                'Optional'
              )
            }
          >
            <SettingsInput
              type='password'
              autoComplete='off'
              spellCheck={false}
              value={config.apiKeys[provider.id] ?? ''}
              placeholder={provider.needsKey ? 'Paste your key' : 'Not needed'}
              onChange={(e) => setFor('apiKeys', e.target.value)}
            />
          </SettingsRow>
          <SettingsRow
            label='Model'
            description={
              <button className='link' onClick={loadModels}>
                Load models
              </button>
            }
          >
            <SettingsInput
              list='shortreader-models'
              spellCheck={false}
              value={config.models[provider.id] ?? provider.suggestedModel ?? ''}
              placeholder='model id'
              onChange={(e) => setFor('models', e.target.value)}
            />
            <datalist id='shortreader-models'>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </SettingsRow>
          <SettingsRow
            label='Answer without thinking'
            description='Faster and cheaper on reasoning models'
            asLabel
          >
            <input
              type='checkbox'
              className='toggle'
              checked={config.disableThinking}
              onChange={(e) => update({ disableThinking: e.target.checked })}
            />
          </SettingsRow>
          <SettingsRow label='Check it works'>
            <button className='btn btn-sm' onClick={testText} disabled={textCheck.state === 'busy'}>
              Test
            </button>
          </SettingsRow>
        </BoxedList>
        <CheckLine check={modelCheck} />
        <CheckLine check={textCheck} />
      </div>

      <div>
        <BoxedList
          title='Pictures'
          description={
            inAppWindow
              ? 'Mind maps, visuals, comics and feed pictures are made in Google Flow or Grok Imagine, in a window inside ShortReader. Sign in there once and pictures are made by themselves. (Google may not allow Google sign-in there; Grok works with email or X.)'
              : phoneHandoff
                ? 'Mind maps, visuals, comics and feed pictures are made in Google Flow or Grok Imagine. Asking for one copies its prompt and opens the app or the web browser — your choice; make the picture there and add it back.'
                : onPhone
                  ? 'Mind maps, visuals, comics and feed pictures are made in Google Flow or Grok Imagine, in a browser on a computer on the same network, through the image bridge there.'
                  : 'Mind maps, visuals, comics and feed pictures are made in Google Flow or Grok Imagine. Asking for one opens the site in its own browser window; sign in once and the picture is made by itself.'
          }
        >
          <SettingsRow label='Make pictures with'>
            <SettingsSelect
              value={config.imageProvider}
              onChange={(e) => update({ imageProvider: e.target.value as ImageProviderId })}
              options={(Object.keys(IMAGE_PROVIDER_LABELS) as ImageProviderId[]).map((id) => ({
                value: id,
                label: IMAGE_PROVIDER_LABELS[id],
              }))}
              ariaLabel='Picture provider'
            />
          </SettingsRow>
          {onPhone && (
            <SettingsRow label='Make pictures on'>
              <SettingsSelect
                value={
                  // iOS has no in-app window: "automatically" means the hand-off there.
                  config.phonePictures === 'phone' && getOSPlatform() !== 'android'
                    ? 'handoff'
                    : config.phonePictures
                }
                onChange={(e) =>
                  update({ phonePictures: e.target.value as 'phone' | 'handoff' | 'computer' })
                }
                options={[
                  ...(getOSPlatform() === 'android'
                    ? [{ value: 'phone', label: 'This phone, automatically' }]
                    : []),
                  { value: 'handoff', label: 'This phone, I paste the prompt' },
                  { value: 'computer', label: 'A computer (image bridge)' },
                ]}
                ariaLabel='Where pictures are made'
              />
            </SettingsRow>
          )}
          {onPhone && !phoneHandoff && (
            <SettingsRow label='Image bridge address'>
              <SettingsInput
                type='url'
                spellCheck={false}
                value={config.bridgeUrl}
                placeholder={DEFAULT_BRIDGE_URL}
                onChange={(e) => update({ bridgeUrl: e.target.value })}
              />
            </SettingsRow>
          )}
          {onPhone && !phoneHandoff && (
            <SettingsRow label='Bridge token' description='Only if you set one on the bridge'>
              <SettingsInput
                type='password'
                autoComplete='off'
                value={config.bridgeToken}
                placeholder='None'
                onChange={(e) => update({ bridgeToken: e.target.value })}
              />
            </SettingsRow>
          )}
          <SettingsRow label={`Sign in to ${IMAGE_PROVIDER_LABELS[config.imageProvider]}`}>
            <div className='flex gap-2'>
              <button className='btn btn-sm' onClick={openProvider}>
                Open
              </button>
              {!phoneHandoff && (
                <button className='btn btn-sm' onClick={checkBridge}>
                  Check
                </button>
              )}
            </div>
          </SettingsRow>
        </BoxedList>
        <CheckLine check={bridgeCheck} />
      </div>

      <Tips>
        <li>
          OpenRouter reaches almost every model (Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen…)
          with one key. Any other OpenAI-compatible service works under “Other”.
        </li>
        <li>Reading scanned books needs a model that reads images.</li>
        {!phoneHandoff && (
          <li>
            Pictures need Microsoft Edge or Google Chrome installed; your usual browser profile is
            never touched.
          </li>
        )}
        {onPhone && !phoneHandoff && (
          <li>
            On the computer, start the image bridge with{' '}
            <code>SHORTREADER_BRIDGE_HOST=0.0.0.0 node tools/image-bridge/bridge.mjs</code> and put
            that computer’s address here.
          </li>
        )}
      </Tips>
    </div>
  );
};

export default AIKeysSettings;
