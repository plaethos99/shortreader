import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  appService: { hasWindowBar: true, hasTrafficLight: false } as Record<string, boolean>,
}));
const traffic = vi.hoisted(() => ({
  setTrafficLightVisibility: vi.fn(async () => {}),
  trafficLightInFullscreen: false,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: env.appService }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: { bookKeys: string[] }) => unknown) => select({ bookKeys: ['a'] }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: { getState: () => ({ getIsSideBarVisible: () => false }) },
}));
vi.mock('@/store/trafficLightStore', () => ({ useTrafficLightStore: () => traffic }));
// The real buttons talk to the Tauri window; what matters here is what the
// bar asks them to show.
vi.mock('@/components/WindowButtons', () => ({
  default: (p: { showMinimize: boolean; showMaximize: boolean; onClose: () => void }) => (
    <div data-testid='buttons'>
      {p.showMinimize && <span>minimize</span>}
      {p.showMaximize && <span>maximize</span>}
      <button onClick={p.onClose}>close</button>
    </div>
  ),
}));

import FeedWindowBar from '@/app/reader/components/scrollfeed/FeedWindowBar';

describe('FeedWindowBar (the curated view on desktop)', () => {
  beforeEach(() => {
    traffic.setTrafficLightVisibility.mockClear();
    traffic.trafficLightInFullscreen = false;
  });
  afterEach(cleanup);

  it('Windows: shows minimize, maximize and close, and the book title', () => {
    env.appService = { hasWindowBar: true, hasTrafficLight: false };
    const onClose = vi.fn();
    render(<FeedWindowBar title='One Italian Summer' onClose={onClose} />);

    expect(screen.getByText('minimize')).toBeTruthy();
    expect(screen.getByText('maximize')).toBeTruthy();
    expect(screen.getByText('One Italian Summer')).toBeTruthy();
    fireEvent.click(screen.getByText('close'));
    expect(onClose).toHaveBeenCalled();
    expect(traffic.setTrafficLightVisibility).not.toHaveBeenCalled();
  });

  it('macOS: keeps the traffic lights showing instead of drawing its own', () => {
    env.appService = { hasWindowBar: true, hasTrafficLight: true };
    const { unmount } = render(<FeedWindowBar title='B' onClose={() => {}} />);

    expect(traffic.setTrafficLightVisibility).toHaveBeenCalledWith(true, 44);
    expect(screen.queryByText('minimize')).toBeNull();
    expect(screen.getByText('close')).toBeTruthy();
    unmount();
    expect(traffic.setTrafficLightVisibility).toHaveBeenLastCalledWith(false);
  });

  it('macOS full screen: the traffic lights are gone, so it draws its own', () => {
    env.appService = { hasWindowBar: true, hasTrafficLight: true };
    traffic.trafficLightInFullscreen = true;
    render(<FeedWindowBar title='B' onClose={() => {}} />);
    expect(screen.getByText('minimize')).toBeTruthy();
  });

  it('phones (Android, iOS): no window bar at all', () => {
    env.appService = { hasWindowBar: false, hasTrafficLight: false };
    const { container } = render(<FeedWindowBar title='B' onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
