import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChapterPicker from '@/app/reader/components/scrollfeed/ChapterPicker';
import type { FeedChapter } from '@/services/scrollfeed/chapters';

const chapters: FeedChapter[] = [
  { idx: 0, title: 'Cells', text: 'a'.repeat(4000) },
  { idx: 1, title: 'Energy', text: 'b'.repeat(4000) },
];

const renderPicker = () => {
  const props = {
    onAskAi: vi.fn(),
    onReadOriginal: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = render(
    <ChapterPicker
      bookTitle='Biology'
      chapters={chapters}
      style='concepts'
      onStyleChange={vi.fn()}
      language='en'
      onLanguageChange={vi.fn()}
      look={{} as never}
      onLookChange={vi.fn()}
      mood={null}
      onMoodChange={vi.fn()}
      streak={0}
      minutes={0}
      listen={<p>Audio story player</p>}
      {...props}
    />,
  );
  return { ...view, ...props };
};

describe('ChapterPicker', () => {
  afterEach(cleanup);

  it('asks AI about a chapter from beside it, without opening the chapter', () => {
    const { getByRole, onAskAi, onOpen } = renderPicker();
    fireEvent.click(getByRole('button', { name: 'Ask AI about “Energy”' }));
    expect(onAskAi).toHaveBeenCalledWith(chapters[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens AI Insights for the whole book from the header', () => {
    const { getByRole, onAskAi } = renderPicker();
    fireEvent.click(getByRole('button', { name: 'AI Insights' }));
    expect(onAskAi).toHaveBeenCalledWith(null);
  });

  it('keeps the original book behind the More menu', () => {
    const { getByRole, queryByRole, onReadOriginal } = renderPicker();
    expect(queryByRole('button', { name: 'Original book' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'More' }));
    fireEvent.click(getByRole('button', { name: 'Original book' }));
    expect(onReadOriginal).toHaveBeenCalled();
  });

  it('switches between the chapter feed and the Listen section', () => {
    const { getByRole, getByText, queryByRole } = renderPicker();
    expect(getByText('Audio story player').closest('[hidden]')).not.toBeNull();
    expect(getByRole('button', { name: /^Cells/ })).toBeTruthy();

    fireEvent.click(getByRole('tab', { name: 'Listen' }));
    expect(getByRole('tab', { name: 'Listen' }).getAttribute('aria-selected')).toBe('true');
    expect(getByText('Audio story player').closest('[hidden]')).toBeNull();
    expect(queryByRole('button', { name: /^Cells/ })).toBeNull();
  });
});
