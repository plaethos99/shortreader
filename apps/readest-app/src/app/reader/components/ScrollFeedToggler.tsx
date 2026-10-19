import { MdOutlineViewCarousel } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useScrollFeedSetting } from '@/app/reader/hooks/useScrollFeedSetting';
import { isScrollFeedConfigured } from '@/services/scrollfeed/generate';
import Button from '@/components/Button';

/**
 * Swap between the curated card feed and the book itself.
 *
 * Not the only way back: the feed is a full-screen overlay and this header
 * auto-hides behind it, so the feed carries its own exit too. This one is for
 * going the other way — entering the feed from the book.
 */
const ScrollFeedToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const iconSize20 = useResponsiveSize(20);
  const { enabled, setEnabled } = useScrollFeedSetting(bookKey);
  const available = isScrollFeedConfigured();

  return (
    <Button
      icon={
        <MdOutlineViewCarousel
          className={enabled ? 'text-blue-500' : 'text-base-content'}
          size={iconSize20}
        />
      }
      aria-label={_('Toggle Curated Feed')}
      disabled={!available}
      onClick={() => setEnabled(!enabled)}
      label={
        available
          ? enabled
            ? _('Read the Book')
            : _('Curated Feed')
          : _('Curated Feed Unavailable')
      }
    ></Button>
  );
};

export default ScrollFeedToggler;
