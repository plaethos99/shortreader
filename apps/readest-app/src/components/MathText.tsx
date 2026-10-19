'use client';

import React, { useMemo } from 'react';

import { hasMath, renderMathText } from '@/utils/mathText';

interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * AI-written text with its LaTeX rendered as math. Text without math renders
 * as a plain string, exactly as before; with math, as sanitized MathML (see
 * utils/mathText).
 */
const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  const html = useMemo(() => (hasMath(text) ? renderMathText(text) : null), [text]);
  if (html === null) return <span className={className}>{text}</span>;
  // Sanitized in renderMathText: escaped prose plus KaTeX MathML only.
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

export default MathText;
