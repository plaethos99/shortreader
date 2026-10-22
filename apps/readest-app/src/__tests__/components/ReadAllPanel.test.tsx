import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  setRate: vi.fn(),
  goToChapter: vi.fn(async () => {}),
  syncChapter: vi.fn(),
  destroy: vi.fn(),
  paused: true,
  currentTime: 0,
  chapterIndex: 0,
}));
vi.mock('@/services/scrollfeed/bookAudioPlayer', () => ({
  BookAudioPlayer: class {
    load = player.load;
    play = async () => {
      player.paused = false;
      await player.play();
    };
    pause = () => {
      player.paused = true;
      player.pause();
    };
    setRate = player.setRate;
    goToChapter = player.goToChapter;
    syncChapter = player.syncChapter;
    destroy = player.destroy;
    get paused() {
      return player.paused;
    }
    get currentTime() {
      return player.currentTime;
    }
    get chapterIndex() {
      return player.chapterIndex;
    }
  },
}));
const feeds = vi.hoisted(() => [
  {
    chapterIdx: 0,
    title: 'Down the Rabbit Hole',
    cards: [{ id: 'a', story: 'Alice is bored.', title: '', points: [], quote: '' }],
  },
  {
    chapterIdx: 1,
    title: 'The Pool of Tears',
    cards: [{ id: 'b', story: 'Alice cries a pool.', title: '', points: [], quote: '' }],
  },
]);
vi.mock('@/services/scrollfeed/feedCache', () => ({
  loadUsableFeed: async () => null,
  loadAllChapterFeeds: async (o: { onProgress?: (d: number, t: number) => void }) => {
    o.onProgress?.(2, 2);
    return feeds;
  },
}));
vi.mock('@/services/scrollfeed/bookAudioStore', () => ({
  recordingKey: () => 'k',
  loadRecording: async () => null,
  saveRecording: vi.fn(async () => {}),
}));
vi.mock('@/libs/edgeTTS', () => ({
  EdgeSpeechTTS: class {
    createAudioData = async () => ({ data: new ArrayBuffer(6000) });
  },
}));

import ReadAllPanel from '@/app/reader/components/scrollfeed/ReadAllPanel';

const chapters = [
  { idx: 0, title: 'Down the Rabbit Hole', text: 'x' },
  { idx: 1, title: 'The Pool of Tears', text: 'y' },
];

describe('Read all panel', () => {
  afterEach(cleanup);

  it('prepares the whole book, shows every chapter’s text, and plays it as one recording', async () => {
    render(
      <ReadAllPanel
        bookHash='b'
        bookTitle='Alice'
        chapters={chapters}
        style='story'
        language='en'
        withText={async (c) => c}
        voices={[]}
        voiceId='en-US-AriaNeural'
        onVoiceChange={() => {}}
        voiceLang='en-US'
        rate={1}
        onRateChange={() => {}}
      />,
    );
    expect(await screen.findByText(/2 of 2 chapters aren’t curated yet/)).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByText('Prepare the whole book')));

    expect(player.load).toHaveBeenCalledTimes(1);
    // All chapters' text, in one place, under chapter headings.
    expect(screen.getByRole('heading', { level: 4, name: '1. Down the Rabbit Hole' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: '2. The Pool of Tears' })).toBeTruthy();
    // The player names the chapter it's on.
    expect(screen.getByRole('heading', { level: 3, name: '1. Down the Rabbit Hole' })).toBeTruthy();
    expect(screen.getByText('Alice cries a pool.')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByLabelText('Play the whole book')));
    expect(player.play).toHaveBeenCalled();

    await act(async () =>
      fireEvent.click(screen.getByRole('heading', { level: 4, name: '2. The Pool of Tears' })),
    );
    expect(player.goToChapter).toHaveBeenLastCalledWith(1);
  });
});
