/**
 * Display size for a card's paragraph, stepped down with length.
 *
 * A card is one ~100-word paragraph of the retelling. One fixed size left a
 * short paragraph floating in the card and pushed a long one up behind the
 * feed's controls; sizing by length keeps every card filling roughly the same
 * space, which is what gives a feed its rhythm.
 */
export const storySizeClass = (story: string): string => {
  const n = story.length;
  if (n <= 450) return 'text-xl sm:text-2xl';
  if (n <= 850) return 'text-lg sm:text-xl';
  return 'text-base sm:text-lg';
};
