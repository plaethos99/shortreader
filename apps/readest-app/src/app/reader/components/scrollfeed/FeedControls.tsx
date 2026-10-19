'use client';

// The feed's floating control cluster: play/pause, speed, narrator, position.
import React from 'react';
import { MdPause, MdPlayArrow } from 'react-icons/md';

import { FEED_SPEEDS, type FeedVoice } from '@/services/scrollfeed/playback';

interface FeedControlsProps {
  playing: boolean;
  onToggle: () => void;
  voices: FeedVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  position: number;
  total: number;
}

const FeedControls: React.FC<FeedControlsProps> = ({
  playing,
  onToggle,
  voices,
  voiceId,
  onVoiceChange,
  rate,
  onRateChange,
  position,
  total,
}) => {
  // Speed cycles rather than opening a menu: it is the control most likely to
  // be adjusted mid-listen, and a one-tap cycle beats a two-tap picker.
  const cycleRate = () => {
    const i = FEED_SPEEDS.indexOf(rate as (typeof FEED_SPEEDS)[number]);
    onRateChange(FEED_SPEEDS[(i + 1) % FEED_SPEEDS.length]!);
  };

  return (
    // Positioned by the feed's header bar, not by itself: two absolutely
    // placed clusters collided at phone width (the play button sat on top of
    // "Read the book").
    <div className='flex items-center gap-1.5 sm:gap-2'>
      <button
        type='button'
        onClick={onToggle}
        aria-label={playing ? 'Pause read-along' : 'Play read-along'}
        aria-pressed={playing}
        className='btn btn-sm btn-ghost eink-bordered'
      >
        {playing ? <MdPause size={16} /> : <MdPlayArrow size={16} />}
      </button>

      <button
        type='button'
        onClick={cycleRate}
        aria-label={`Playback speed ${rate}x`}
        className='btn btn-sm btn-ghost eink-bordered tabular-nums'
      >
        {rate}×
      </button>

      {voices.length > 1 && (
        <select
          aria-label='Narrator'
          value={voiceId}
          onChange={(e) => onVoiceChange(e.target.value)}
          className='select select-sm eink-bordered w-20 max-w-28 sm:w-auto'
        >
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </select>
      )}

      <span className='shrink-0 text-xs opacity-60 tabular-nums'>
        {position} / {total}
      </span>
    </div>
  );
};

export default FeedControls;
