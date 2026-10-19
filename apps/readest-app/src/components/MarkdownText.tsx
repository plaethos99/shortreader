'use client';

import clsx from 'clsx';
import React, { useMemo } from 'react';

import { renderMarkdownMath } from '@/utils/mathText';

interface MarkdownTextProps {
  text: string;
  className?: string;
}

// Typography's colours follow the surrounding text, so a reply reads the same
// in a chat bubble, on the panel and in every theme.
const INHERIT_COLORS = {
  '--tw-prose-body': 'currentColor',
  '--tw-prose-headings': 'currentColor',
  '--tw-prose-bold': 'currentColor',
  '--tw-prose-links': 'currentColor',
  '--tw-prose-code': 'currentColor',
  '--tw-prose-quotes': 'currentColor',
  '--tw-prose-counters': 'currentColor',
  '--tw-prose-bullets': 'currentColor',
  '--tw-prose-th-borders': 'color-mix(in srgb, currentColor 30%, transparent)',
  '--tw-prose-td-borders': 'color-mix(in srgb, currentColor 20%, transparent)',
  '--tw-prose-hr': 'color-mix(in srgb, currentColor 20%, transparent)',
  '--tw-prose-quote-borders': 'color-mix(in srgb, currentColor 30%, transparent)',
} as React.CSSProperties;

/**
 * AI-written Markdown — bold, lists, headings, tables, code — with its LaTeX
 * rendered as math. Sanitized HTML (see utils/mathText).
 */
const MarkdownText: React.FC<MarkdownTextProps> = ({ text, className }) => {
  const html = useMemo(() => renderMarkdownMath(text), [text]);
  return (
    <div
      className={clsx(
        'prose prose-sm max-w-none [&>:first-child]:mt-0 [&>:last-child]:mb-0',
        'prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-4',
        className,
      )}
      style={INHERIT_COLORS}
      // Sanitized in renderMarkdownMath.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownText;
