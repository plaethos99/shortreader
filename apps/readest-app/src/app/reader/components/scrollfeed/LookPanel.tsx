'use client';

// The feed's look settings: text motion, background, colours, sound, haptics.
// Motion and background apply to focus mode too.
import React from 'react';

import { BACKDROPS, FEED_MOODS, type FeedMood, TEXT_MOTIONS } from '@/services/scrollfeed/ambience';
import type { FeedLook } from '@/services/scrollfeed/store';

interface LookPanelProps {
  look: FeedLook;
  onLookChange: (look: FeedLook) => void;
  mood: FeedMood | null;
  onMoodChange: (mood: FeedMood) => void;
}

const LookPanel: React.FC<LookPanelProps> = ({ look, onLookChange, mood, onMoodChange }) => (
  <div className='eink-bordered bg-base-200/60 mb-4 grid grid-cols-1 gap-3 rounded-xl p-4 text-sm sm:grid-cols-2'>
    <label className='flex items-center justify-between gap-2'>
      Text
      <select
        className='select select-bordered select-sm eink-bordered'
        value={look.motion}
        onChange={(e) => onLookChange({ ...look, motion: e.target.value as FeedLook['motion'] })}
      >
        {TEXT_MOTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
    <label className='flex items-center justify-between gap-2'>
      Background
      <select
        className='select select-bordered select-sm eink-bordered'
        value={look.backdrop}
        onChange={(e) =>
          onLookChange({ ...look, backdrop: e.target.value as FeedLook['backdrop'] })
        }
      >
        {BACKDROPS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
    <label className='flex items-center justify-between gap-2'>
      Colours
      <select
        className='select select-bordered select-sm eink-bordered'
        value={mood ?? ''}
        disabled={!mood}
        onChange={(e) => onMoodChange(e.target.value as FeedMood)}
      >
        {!mood && <option value=''>Reading the book…</option>}
        {FEED_MOODS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
    <div className='flex items-center justify-between gap-4'>
      <label className='flex items-center gap-2'>
        <input
          type='checkbox'
          className='toggle toggle-sm'
          checked={look.sound}
          onChange={(e) => onLookChange({ ...look, sound: e.target.checked })}
        />
        Sound
      </label>
      <label className='flex items-center gap-2'>
        <input
          type='checkbox'
          className='toggle toggle-sm'
          checked={look.haptics}
          onChange={(e) => onLookChange({ ...look, haptics: e.target.checked })}
        />
        Haptics
      </label>
    </div>
  </div>
);

export default LookPanel;
