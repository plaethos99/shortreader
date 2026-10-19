'use client';

/**
 * The card after a chapter's last: a moment of completion, and a hook into the
 * next chapter — the tension this one ends on, and the way on, already loaded
 * in the background.
 */
import React from 'react';
import { MdCheck } from 'react-icons/md';

interface ChapterEndCardProps {
  active: boolean;
  cardCount: number;
  // Minutes the chapter would take to read in full.
  bookMinutes: number;
  teaser: string;
  nextTitle: string | null;
  onNext: () => void;
}

const ChapterEndCard: React.FC<ChapterEndCardProps> = ({
  active,
  cardCount,
  bookMinutes,
  teaser,
  nextTitle,
  onNext,
}) => (
  <section
    className='relative flex h-full w-full snap-start snap-always flex-col items-center justify-center px-8 pt-28 pb-12 text-center sm:pt-20'
    style={{ scrollSnapStop: 'always' }}
  >
    <div
      className='border-primary/60 text-primary flex h-16 w-16 items-center justify-center rounded-full border-2'
      style={
        active ? { animation: 'feed-complete 700ms cubic-bezier(.2,.7,.2,1) both' } : { opacity: 0 }
      }
    >
      <MdCheck size={34} />
    </div>
    <h3
      className='mt-5 text-2xl font-semibold'
      style={active ? { animation: 'feed-rise 600ms ease-out 250ms both' } : { opacity: 0 }}
    >
      Chapter complete
    </h3>
    <p
      className='text-base-content/70 mt-2 text-sm'
      style={active ? { animation: 'feed-rise 600ms ease-out 400ms both' } : { opacity: 0 }}
    >
      {cardCount} {cardCount === 1 ? 'card' : 'cards'} · about {bookMinutes} min of the book
    </p>

    {teaser && (
      <p
        className='mx-auto mt-8 max-w-md font-serif text-xl italic leading-snug'
        style={active ? { animation: 'feed-soft 1200ms ease-out 900ms both' } : { opacity: 0 }}
      >
        {teaser}
      </p>
    )}

    {nextTitle ? (
      <button
        type='button'
        onClick={onNext}
        className='btn btn-contrast mt-8 max-w-full'
        style={active ? { animation: 'feed-rise 600ms ease-out 1500ms both' } : { opacity: 0 }}
      >
        <span className='truncate'>Next: {nextTitle}</span>
      </button>
    ) : (
      <p className='text-base-content/70 mt-8 text-sm'>You've reached the end of the book.</p>
    )}
  </section>
);

export default ChapterEndCard;
