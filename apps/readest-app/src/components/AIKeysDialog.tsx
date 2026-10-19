'use client';

// The AI keys setup as its own dialog, opened from anywhere with
// eventDispatcher.dispatch('show-ai-keys') — the AI Insights panel, the feed.
import { useEffect, useState } from 'react';

import Dialog from '@/components/Dialog';
import AIKeysSettings from '@/components/settings/AIKeysSettings';
import { eventDispatcher } from '@/utils/event';

export const showAIKeys = () => eventDispatcher.dispatch('show-ai-keys');

const AIKeysDialog: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onShow = () => setOpen(true);
    eventDispatcher.on('show-ai-keys', onShow);
    return () => eventDispatcher.off('show-ai-keys', onShow);
  }, []);

  return (
    <Dialog
      isOpen={open}
      onClose={() => setOpen(false)}
      title='AI keys & models'
      boxClassName='sm:!w-[560px] sm:!max-w-[96vw]'
    >
      {open && <AIKeysSettings />}
    </Dialog>
  );
};

export default AIKeysDialog;
