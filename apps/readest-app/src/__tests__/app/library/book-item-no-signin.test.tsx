import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';

const { mockAuth, routerPush } = vi.hoisted(() => ({
  mockAuth: { user: null as { id: string } | null },
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockAuth.user }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: true } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/services/sync/cloudSyncProvider', () => ({ isReadestCloudStorageActive: () => false }));
vi.mock('@/components/BookCover', () => ({ default: () => <div>cover</div> }));
vi.mock('@/app/library/components/ReadingProgress', () => ({ default: () => null }));

import BookItem from '@/app/library/components/BookItem';

const book = {
  hash: 'hash1',
  format: 'EPUB',
  title: 'A Local Book',
  author: 'Someone',
  createdAt: 0,
  updatedAt: 0,
} as Book;

const renderItem = () =>
  render(
    <BookItem
      book={book}
      mode='grid'
      coverFit='crop'
      isSelectMode={false}
      bookSelected={false}
      transferProgress={null}
      handleBookUpload={vi.fn()}
      handleBookDownload={vi.fn()}
      showBookDetailsModal={vi.fn()}
      showTimeRemaining={false}
    />,
  );

describe('BookItem cloud button (Readster: no Readest account)', () => {
  beforeEach(() => {
    routerPush.mockReset();
  });
  afterEach(cleanup);

  it('renders no Readest cloud upload button for a signed-out user', () => {
    mockAuth.user = null;
    renderItem();
    expect(screen.queryByLabelText('Upload Book')).toBeNull();
  });

  it('keeps the upload button for a signed-in Readest user', () => {
    mockAuth.user = { id: 'u' };
    renderItem();
    expect(screen.getByLabelText('Upload Book')).toBeTruthy();
  });
});
