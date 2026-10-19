'use client';

// The curated feed's title bar, desktop only (Windows, macOS, Linux).
//
// The feed is drawn over the reader, so it covered the reader's own header —
// the one that holds minimize / maximize / close on Windows and Linux, shows
// the traffic lights on macOS, and drags the window. That header only appears
// when the pointer reaches the top strip, which the feed sat on top of: in the
// feed the window could not be moved, resized or closed. This bar gives the
// feed those controls itself, always visible. Phones have no window bar, so
// nothing renders there and the feed is unchanged.
import React, { useEffect, useRef } from 'react';

import WindowButtons from '@/components/WindowButtons';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';

// The reader header's height (h-11): the traffic lights are centred in it.
export const FEED_WINDOW_BAR_HEIGHT = 44;

/** Whether this copy of the app draws the feed's window bar. */
export const useHasFeedWindowBar = (): boolean => {
  const { appService } = useEnv();
  return !!appService?.hasWindowBar;
};

interface FeedWindowBarProps {
  title: string;
  onClose: () => void;
}

const FeedWindowBar: React.FC<FeedWindowBarProps> = ({ title, onClose }) => {
  const { appService } = useEnv();
  const barRef = useRef<HTMLDivElement>(null);
  const bookCount = useReaderStore((s) => s.bookKeys.length);
  const { trafficLightInFullscreen, setTrafficLightVisibility } = useTrafficLightStore();
  const hasTrafficLight = !!appService?.hasTrafficLight;

  // macOS: keep the traffic lights showing, centred in this bar, while the
  // feed is open; hand them back to the reader's hover logic on the way out.
  useEffect(() => {
    if (!hasTrafficLight) return;
    void setTrafficLightVisibility(true, FEED_WINDOW_BAR_HEIGHT);
    return () => {
      if (!useSidebarStore.getState().getIsSideBarVisible()) {
        void setTrafficLightVisibility(false);
      }
    };
  }, [hasTrafficLight, setTrafficLightVisibility]);

  if (!appService?.hasWindowBar) return null;

  // Windows and Linux draw their own minimize / maximize; macOS has the
  // traffic lights for those (except in full screen, where they are hidden).
  const ownWindowButtons = !hasTrafficLight || trafficLightInFullscreen;

  return (
    <div
      ref={barRef}
      data-testid='feed-window-bar'
      className='bg-base-100/80 absolute inset-x-0 top-0 z-40 flex items-center gap-2 pe-3 backdrop-blur-sm'
      style={{ height: FEED_WINDOW_BAR_HEIGHT }}
    >
      {/* Room for the traffic lights on macOS. */}
      <div
        className={hasTrafficLight && !trafficLightInFullscreen ? 'w-20 shrink-0' : 'w-3 shrink-0'}
      />
      <div className='text-base-content/70 pointer-events-none min-w-0 flex-1 truncate text-center text-sm'>
        {title}
      </div>
      {/* Drags the window from the bar (WindowButtons listens on barRef). */}
      <WindowButtons
        className='window-buttons flex items-center'
        headerRef={barRef}
        showMinimize={bookCount === 1 && ownWindowButtons}
        showMaximize={bookCount === 1 && ownWindowButtons}
        closeButtonLabel='Close Book'
        onClose={onClose}
      />
    </div>
  );
};

export default FeedWindowBar;
