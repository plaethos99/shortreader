'use client';

// The feed's floating header: back to the chapters, Ask AI about this chapter,
// and the player when a chapter is open.
//
// One bar holds both. As two absolutely positioned clusters (way out pinned
// left, player pinned right) they overlapped at phone width — the play button
// landed on top of the button beside "Chapters". Wrapping drops the player onto its own
// line when the two groups no longer fit side by side; ScrollFeedCard's top
// padding leaves room for that second line below `sm`.
import React from 'react';

interface FeedChromeProps {
  topInset: number;
  onBackToChapters: () => void;
  askAi: React.ReactNode;
  controls?: React.ReactNode;
}

const FeedChrome: React.FC<FeedChromeProps> = ({ topInset, onBackToChapters, askAi, controls }) => (
  <div
    data-testid='feed-chrome'
    className='absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 py-3'
    style={{ paddingTop: topInset + 12 }}
  >
    <div className='flex items-center gap-1.5 sm:gap-2'>
      <button
        type='button'
        onClick={onBackToChapters}
        className='btn btn-sm btn-ghost eink-bordered px-2 sm:px-3'
      >
        ‹ Chapters
      </button>
      {askAi}
    </div>
    {controls}
  </div>
);

export default FeedChrome;
