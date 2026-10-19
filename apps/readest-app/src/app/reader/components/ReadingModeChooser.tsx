'use client';

// The first time a book is opened: read the original, or the curated view?
// Shown over the book until the reader picks; the pick is remembered for the
// book (services/readingMode) and can be changed later from the reader's top
// bar or the feed's chapter list.
import React from 'react';
import { MdOutlineMenuBook } from 'react-icons/md';

import AiInsightsMark from '@/components/AiInsightsMark';
import type { ReadingMode } from '@/services/readingMode';
import FeedWindowBar, {
  FEED_WINDOW_BAR_HEIGHT,
  useHasFeedWindowBar,
} from './scrollfeed/FeedWindowBar';

interface ReadingModeChooserProps {
  bookTitle: string;
  topInset: number;
  onChoose: (mode: ReadingMode) => void;
  onCloseBook: () => void;
}

const Option: React.FC<{
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}> = ({ icon, title, text, onClick }) => (
  <button
    type='button'
    onClick={onClick}
    className='border-base-300 bg-base-100 hover:border-primary hover:bg-base-200/60 focus-visible:border-primary eink-bordered flex w-full flex-1 flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-colors sm:min-h-56'
  >
    <span className='text-primary'>{icon}</span>
    <span className='text-lg font-semibold'>{title}</span>
    <span className='text-base-content/70 text-sm leading-relaxed'>{text}</span>
  </button>
);

const ReadingModeChooser: React.FC<ReadingModeChooserProps> = ({
  bookTitle,
  topInset,
  onChoose,
  onCloseBook,
}) => {
  const hasWindowBar = useHasFeedWindowBar();
  return (
    <div
      data-testid='reading-mode-chooser'
      className='bg-base-100 absolute inset-0 z-30 overflow-y-auto'
      style={{ paddingTop: topInset + (hasWindowBar ? FEED_WINDOW_BAR_HEIGHT : 0) }}
    >
      {/* Desktop: the reader's header (window buttons, dragging) is under
          this screen, so it carries the same bar as the feed. */}
      {hasWindowBar && <FeedWindowBar title={bookTitle} onClose={onCloseBook} />}
      <div className='mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6 px-5 py-8'>
        <div className='text-center'>
          <p className='text-base-content/60 text-sm'>How would you like to read</p>
          <h1 className='mt-1 line-clamp-2 text-2xl font-semibold'>{bookTitle}</h1>
        </div>
        <div className='flex flex-col gap-4 sm:flex-row'>
          <Option
            icon={<MdOutlineMenuBook size={40} />}
            title='Original book'
            text='The book as written, page by page, with all of the reader’s tools.'
            onClick={() => onChoose('original')}
          />
          <Option
            icon={<AiInsightsMark size={40} />}
            title='Curated view'
            text='Each chapter retold as short cards in your language, with pictures and read-aloud.'
            onClick={() => onChoose('curated')}
          />
        </div>
        <p className='text-base-content/55 text-center text-xs'>
          You can switch between them any time from the top bar.
        </p>
      </div>
    </div>
  );
};

export default ReadingModeChooser;
