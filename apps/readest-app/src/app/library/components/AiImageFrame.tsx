'use client';

import React, { useState } from 'react';
import { HiArrowsPointingOut } from 'react-icons/hi2';

import BookCoverViewer from '@/components/BookCoverViewer';

interface AiImageFrameProps {
  src: string;
  alt: string;
  caption?: string;
  // Stored-tab thumbnails are small; the insight tabs show the image large.
  compact?: boolean;
}

/**
 * A generated mind map / visual / comic, framed as a card. Tapping it opens the
 * reader's full-screen image viewer — pinch or ctrl+wheel to zoom, drag to pan,
 * double-tap for 1:1, save — the same one used for in-book images and covers.
 * A mind map's labels are unreadable at panel width, so zoom is the point.
 */
const AiImageFrame: React.FC<AiImageFrameProps> = ({ src, alt, caption, compact }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <figure className='eink-bordered border-base-300 bg-base-200/60 group overflow-hidden rounded-xl border shadow-sm'>
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label={`Open ${alt} full screen`}
          className='relative block w-full cursor-zoom-in overflow-hidden'
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={`mx-auto block w-full object-contain transition-transform duration-300 group-hover:scale-[1.02] ${
              compact ? 'max-h-40' : 'max-h-[70vh]'
            }`}
          />
          <span className='not-eink:bg-black/60 not-eink:text-white eink-bordered absolute right-2 bottom-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] backdrop-blur-sm'>
            <HiArrowsPointingOut className='h-3.5 w-3.5' />
            {compact ? '' : 'Tap to zoom'}
          </span>
        </button>
        {caption && (
          <figcaption className='text-base-content/70 border-base-300 border-t px-3 py-2 text-xs'>
            {caption}
          </figcaption>
        )}
      </figure>
      {open && <BookCoverViewer src={src} onClose={() => setOpen(false)} />}
    </>
  );
};

export default AiImageFrame;
