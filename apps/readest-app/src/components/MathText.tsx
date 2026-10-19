'use client';

import React, { useMemo } from 'react';

import { hasMath, renderInlineMarkdownMath } from '@/utils/mathText';

interface MathTextProps {
  text: string;
  className?: string;
}

// Markdown's inline marks, which models use even in short items.
const INLINE_MARKS = /[*_`~]/;

/**
 * A short piece of AI-written text: its LaTeX rendered as math and its inline
 * Markdown (bold, italics, code) applied. Text with neither renders as a plain
 * string; otherwise as sanitized HTML (see utils/mathText). Paragraph-length
 * replies use MarkdownText.
 */
const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  const html = useMemo(
    () => (INLINE_MARKS.test(text) || hasMath(text) ? renderInlineMarkdownMath(text) : null),
    [text],
  );
  if (html === null) return <span className={className}>{text}</span>;
  // Sanitized in renderInlineMarkdownMath.
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

export default MathText;
