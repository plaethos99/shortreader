'use client';

// Lines the reader kept from the feed (long-press a card), newest first,
// across every book. The seed of sharing curated content later.
import React, { useEffect, useState } from 'react';
import { MdDeleteOutline } from 'react-icons/md';

import { deleteHighlight, type FeedHighlight, loadHighlights } from '@/services/scrollfeed/store';

const HighlightsPanel: React.FC = () => {
  const [highlights, setHighlights] = useState<FeedHighlight[] | null>(null);

  useEffect(() => {
    void loadHighlights().then(setHighlights);
  }, []);

  const remove = async (h: FeedHighlight) => {
    await deleteHighlight(h.bookHash, h.cardId);
    setHighlights((list) => list?.filter((x) => x !== h) ?? null);
  };

  if (!highlights) return null;
  if (highlights.length === 0) {
    return (
      <p className='text-base-content/60 mb-4 text-sm'>Long-press any card to keep it here.</p>
    );
  }
  return (
    <ul className='mb-4 flex flex-col gap-2'>
      {highlights.map((h) => (
        <li
          key={`${h.bookHash}:${h.cardId}`}
          className='eink-bordered bg-base-200/60 rounded-xl p-4'
        >
          <p className='font-serif leading-relaxed'>{h.text}</p>
          <div className='text-base-content/60 mt-2 flex items-center justify-between gap-2 text-xs'>
            <span className='truncate'>
              {h.bookTitle} · {h.chapterTitle}
            </span>
            <button
              type='button'
              aria-label='Remove highlight'
              className='btn btn-ghost btn-xs'
              onClick={() => void remove(h)}
            >
              <MdDeleteOutline size={16} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

export default HighlightsPanel;
