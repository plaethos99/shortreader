import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const open = vi.hoisted(() => vi.fn(async () => 'opened'));
const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/services/pictureHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pictureHandoff')>()),
  openPictureSite: open,
}));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: copy }));
vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

import PictureHandoffDialog from '@/components/PictureHandoffDialog';
import { requestPictureHandoff } from '@/services/pictureHandoff';

describe('PictureHandoffDialog (pictures on a phone)', () => {
  afterEach(cleanup);

  it('copies the prompt, opens the app or browser, and returns the added picture', async () => {
    render(<PictureHandoffDialog />);
    let result: Promise<string> = Promise.resolve('');
    await act(async () => {
      result = requestPictureHandoff('flow', 'Alice falling down the well', '16:9');
    });

    expect(screen.getByText('Make this picture in Google Flow')).toBeTruthy();
    expect(copy).toHaveBeenCalledWith('Alice falling down the well');
    expect(screen.getByText(/landscape \(16:9\)/)).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByText('Flow app')));
    expect(open).toHaveBeenLastCalledWith('flow', 'app');
    await act(async () => fireEvent.click(screen.getByText('Web browser')));
    expect(open).toHaveBeenLastCalledWith('flow', 'browser');

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const picture = new File([new Uint8Array([137, 80])], 'flow.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [picture] } });
      await new Promise((r) => setTimeout(r, 20));
    });
    await expect(result).resolves.toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText('Make this picture in Google Flow')).toBeNull();
  });

  it('offers Google Play when the app is not installed', async () => {
    open.mockResolvedValueOnce('not-installed');
    render(<PictureHandoffDialog />);
    await act(async () => {
      void requestPictureHandoff('imagine', 'x', '1:1').catch(() => {});
    });
    await act(async () => fireEvent.click(screen.getByText('Grok app')));
    expect(screen.getByText('Get it on Google Play')).toBeTruthy();
  });
});
