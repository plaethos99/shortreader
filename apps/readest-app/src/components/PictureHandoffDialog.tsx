'use client';

// On a phone, a picture is made by the reader in the Google Flow or Grok app
// (or the website) and brought back here: the prompt is copied, the app or the
// browser opens — the reader's choice — and "Add the picture" takes it from
// the phone's gallery. See services/pictureHandoff.
import React, { useEffect, useRef, useState } from 'react';
import {
  MdCheck,
  MdContentCopy,
  MdOpenInBrowser,
  MdOutlineImage,
  MdPhoneAndroid,
} from 'react-icons/md';

import Dialog from '@/components/Dialog';
import {
  ASPECT_WORDS,
  PICTURE_HANDOFF_EVENT,
  PICTURE_SITES,
  openPictureSite,
  readImageFile,
  storeUrl,
  type PictureHandoffRequest,
} from '@/services/pictureHandoff';
import { eventDispatcher } from '@/utils/event';
import { writeTextToClipboard } from '@/utils/clipboard';

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <div className='flex gap-3'>
    <span className='bg-primary/15 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
      {n}
    </span>
    <div className='min-w-0 flex-1 space-y-2'>
      <p className='text-sm font-medium'>{title}</p>
      {children}
    </div>
  </div>
);

const PictureHandoffDialog: React.FC = () => {
  const [request, setRequest] = useState<PictureHandoffRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [notInstalled, setNotInstalled] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onShow = (e: CustomEvent) => {
      const next = e.detail as PictureHandoffRequest;
      setRequest(next);
      setNotInstalled(false);
      setError('');
      setCopied(false);
      // Copied straight away: it's what the reader pastes into Flow / Grok.
      void writeTextToClipboard(next.prompt).then(setCopied);
    };
    eventDispatcher.on(PICTURE_HANDOFF_EVENT, onShow);
    return () => eventDispatcher.off(PICTURE_HANDOFF_EVENT, onShow);
  }, []);

  if (!request) return null;
  const site = PICTURE_SITES[request.provider];

  const close = () => {
    request.reject(new Error('No picture was added.'));
    setRequest(null);
  };

  const copy = async () => setCopied(await writeTextToClipboard(request.prompt));

  const open = async (target: 'app' | 'browser') => {
    setError('');
    try {
      const result = await openPictureSite(request.provider, target);
      setNotInstalled(result === 'not-installed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readImageFile(file);
      request.resolve(dataUrl);
      setRequest(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      isOpen={!!request}
      onClose={close}
      title={`Make this picture in ${site.label}`}
      boxClassName='sm:!w-[520px] sm:!max-w-[96vw]'
    >
      <div className='space-y-5 px-1 py-2'>
        <Step n={1} title={copied ? 'The prompt is copied' : 'Copy the prompt'}>
          <p className='bg-base-200/60 text-base-content/80 max-h-28 overflow-y-auto rounded-lg p-3 text-xs leading-relaxed'>
            {request.prompt}
          </p>
          <button className='btn btn-sm btn-ghost gap-1.5' onClick={copy}>
            {copied ? <MdCheck size={16} /> : <MdContentCopy size={16} />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </Step>

        <Step n={2} title={`Open ${site.label}`}>
          <div className='flex flex-wrap gap-2'>
            <button className='btn btn-sm btn-primary gap-1.5' onClick={() => open('app')}>
              <MdPhoneAndroid size={16} />
              {site.appLabel}
            </button>
            <button className='btn btn-sm gap-1.5' onClick={() => open('browser')}>
              <MdOpenInBrowser size={16} />
              Web browser
            </button>
          </div>
          {notInstalled && (
            <p className='text-base-content/70 text-xs'>
              The {site.appLabel} isn’t on this phone.{' '}
              <button className='link' onClick={() => void openStore(request.provider)}>
                Get it on Google Play
              </button>{' '}
              or use the web browser.
            </p>
          )}
          <p className='text-base-content/60 text-xs'>
            Paste the prompt, choose {ASPECT_WORDS[request.aspect]}, make the picture and save it to
            your phone.
          </p>
        </Step>

        <Step n={3} title='Come back and add it'>
          <button
            className='btn btn-sm btn-primary gap-1.5'
            onClick={() => fileRef.current?.click()}
          >
            <MdOutlineImage size={16} />
            Add the picture
          </button>
          <input
            ref={fileRef}
            type='file'
            accept='image/*'
            className='hidden'
            onChange={(e) => {
              void addPicture(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Step>

        {error && <p className='text-error text-xs'>{error}</p>}
        <p className='text-base-content/50 text-xs'>
          Have a computer nearby? Settings → AI Keys → Pictures can make them there by themselves
          instead (image bridge).
        </p>
      </div>
    </Dialog>
  );
};

const openStore = async (provider: PictureHandoffRequest['provider']) => {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(storeUrl(provider));
};

export default PictureHandoffDialog;
