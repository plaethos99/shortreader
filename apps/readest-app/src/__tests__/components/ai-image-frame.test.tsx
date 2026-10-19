import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/components/BookCoverViewer', () => ({
  default: ({ src, onClose }: { src: string; onClose: () => void }) => (
    <div data-testid='viewer' data-src={src}>
      <button type='button' onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import AiImageFrame from '@/app/library/components/AiImageFrame';

afterEach(cleanup);

describe('AiImageFrame', () => {
  test('opens the zoomable viewer on tap and closes it again', () => {
    render(<AiImageFrame src='data:image/png;base64,AAAA' alt='Mind map' caption='Hub' />);

    expect(screen.queryByTestId('viewer')).toBeNull();
    expect(screen.getByText('Hub')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Mind map full screen' }));
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toBe(
      'data:image/png;base64,AAAA',
    );

    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByTestId('viewer')).toBeNull();
  });
});
