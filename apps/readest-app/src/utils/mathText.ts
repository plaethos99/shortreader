/**
 * Math in AI-written text (the curated feed and AI Insights).
 *
 * For technical books the model writes equations as LaTeX between `$...$`,
 * `$$...$$`, `\(...\)` or `\[...\]`, which the UI used to show raw
 * ("$v = \frac{d}{t}$"). This renders those spans with KaTeX, as MathML the
 * browser draws natively — the same approach as annotation notes
 * (noteMarkdown.ts), so no KaTeX stylesheet is needed — and leaves the rest as
 * plain, escaped text. The output is sanitized, so it is safe for
 * dangerouslySetInnerHTML.
 */
import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked } from 'marked';

// $$display$$ | \[display\] | \(inline\) | $inline$. An inline `$` must be
// followed by a non-space and closed by a non-space `$` that is not followed by
// a digit, so "$5 and then $10" stays prose. No lookbehind: the build rejects
// lookbehind regexes in shipped chunks (check:lookbehind-regex).
const MATH_RE =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:[^$\n]|\n(?!\n))*?[^\s$])\$(?!\d)/g;

interface Segment {
  text: string;
  math?: { latex: string; display: boolean };
}

/**
 * The cards arrive as JSON, where `\f` `\t` `\b` `\v` `\r` `\n` are escapes: a
 * LaTeX command the model forgot to double-escape decodes to a control
 * character plus the rest of its name ("\frac" -> form feed + "rac", "\theta"
 * -> tab + "heta", "\nabla" -> newline + "abla"). Put the backslash back.
 */
const repairEscapes = (latex: string): string =>
  latex
    .replace(/\f/g, '\\f')
    .replace(/\t/g, '\\t')
    .replace(/[\b]/g, '\\b')
    .replace(/\v/g, '\\v')
    .replace(/\r(?=[a-zA-Z])/g, '\\r')
    .replace(/\n(?=[a-zA-Z])/g, '\\n');

// Undo those escapes before looking for math, or the delimiter check (a `$`
// must be followed by a non-space) rejects "$<form feed>rac". Form feed,
// backspace, vertical tab and tab never belong in this prose, so they are
// restored anywhere; a newline or carriage return only right after an opening
// delimiter, since elsewhere it is a real line break.
const repairBeforeSplit = (text: string): string =>
  text
    .replace(/\f(?=[a-zA-Z])/g, '\\f')
    .replace(/[\b](?=[a-zA-Z])/g, '\\b')
    .replace(/\v(?=[a-zA-Z])/g, '\\v')
    .replace(/\t(?=[a-zA-Z])/g, '\\t')
    .replace(/(\$\$?|\\\(|\\\[)\n(?=[a-zA-Z])/g, '$1\\n')
    .replace(/(\$\$?|\\\(|\\\[)\r(?=[a-zA-Z])/g, '$1\\r');

const split = (text: string): Segment[] => {
  const source = repairBeforeSplit(text);
  const segments: Segment[] = [];
  let last = 0;
  for (const match of source.matchAll(MATH_RE)) {
    const [whole, displayDollar, displayBracket, inlineParen, inlineDollar] = match;
    if (match.index > last) segments.push({ text: source.slice(last, match.index) });
    const latex = displayDollar ?? displayBracket ?? inlineParen ?? inlineDollar ?? '';
    segments.push({
      text: whole,
      math: {
        latex: repairEscapes(latex.trim()),
        display: displayDollar !== undefined || displayBracket !== undefined,
      },
    });
    last = match.index + whole.length;
  }
  if (last < source.length) segments.push({ text: source.slice(last) });
  return segments;
};

export const hasMath = (text: string): boolean => split(text).some((s) => s.math);

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderMath = (math: NonNullable<Segment['math']>): string =>
  katex.renderToString(math.latex, {
    displayMode: math.display,
    output: 'mathml',
    // Bad LaTeX renders red with the error on hover instead of throwing.
    throwOnError: false,
    // No \href, \url or \includegraphics from model output.
    trust: false,
  });

const sanitize = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'a', 'img'],
  });

/** Text with its math rendered as MathML; sanitized HTML. */
export const renderMathText = (text: string): string =>
  sanitize(
    split(text)
      .map(({ text: raw, math }) => (math ? renderMath(math) : escapeHtml(raw)))
      .join(''),
  );

// AI replies are Markdown (bold, lists, headings, tables). A scoped parser, as
// the shared `marked` singleton is configured elsewhere; `breaks` keeps the
// model's single line breaks as breaks.
const aiMarkdown = new Marked({ gfm: true, breaks: true });

/**
 * AI-written Markdown with its math rendered as MathML; sanitized HTML. Math
 * is found first, with the same repairs as renderMathText, and held out of the
 * Markdown pass as placeholders, so `_` and `*` inside LaTeX don't become
 * emphasis.
 */
const renderWithMarkdown = (text: string, inline: boolean): string => {
  const maths: string[] = [];
  const source = split(text)
    .map(({ text: raw, math }) => {
      if (!math) return raw;
      maths.push(renderMath(math));
      return `MATHSLOT${maths.length - 1}TOLSHTAM`;
    })
    .join('');
  const parsed = inline
    ? aiMarkdown.parseInline(source, { async: false })
    : aiMarkdown.parse(source, { async: false });
  const html = (parsed as string).replace(
    /MATHSLOT(\d+)TOLSHTAM/g,
    (_, i: string) => maths[Number(i)] ?? '',
  );
  return sanitize(html);
};

export const renderMarkdownMath = (text: string): string => renderWithMarkdown(text, false);

/** One line or short item: bold, italics and code, plus math; no blocks. */
export const renderInlineMarkdownMath = (text: string): string => renderWithMarkdown(text, true);

const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'chi',
  'psi',
  'omega',
];

/** One math span in words, for read-aloud. Covers the notation physics and
 * maths books lean on; anything else loses its markup rather than being read
 * out as "backslash". */
const latexToWords = (latex: string): string => {
  let s = repairEscapes(latex)
    // Text labels first, so "v_{\text{avg}}" is a plain "v_{avg}" subscript.
    .replace(/\\(text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$2')
    .replace(/\\lim\s*_\s*\{([^{}]*)\}/g, ' the limit as $1 of ');
  // Innermost first, so nested fractions and roots unwrap one layer a pass.
  for (let i = 0; i < 5; i++) {
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' ($1) over ($2) ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' square root of ($1) ');
  }
  s = s
    .replace(/\^\s*2(?![0-9])/g, ' squared ')
    .replace(/\^\s*3(?![0-9])/g, ' cubed ')
    .replace(/\^\s*\{([^{}]*)\}/g, ' to the power $1 ')
    .replace(/\^\s*([A-Za-z0-9])/g, ' to the power $1 ')
    .replace(/_\s*\{([^{}]*)\}/g, ' sub $1 ')
    .replace(/_\s*([A-Za-z0-9])/g, ' sub $1 ')
    .replace(/\\(times|cdot)/g, ' times ')
    .replace(/\\pm/g, ' plus or minus ')
    .replace(/\\(approx|sim)/g, ' approximately ')
    .replace(/\\(neq|ne)(?![a-z])/g, ' not equal to ')
    .replace(/\\(leq|le)(?![a-z])/g, ' less than or equal to ')
    .replace(/\\(geq|ge)(?![a-z])/g, ' greater than or equal to ')
    .replace(/\\(rightarrow|to)(?![a-z])/g, ' goes to ')
    .replace(/\\infty/g, ' infinity ')
    .replace(/\\nabla/g, ' del ')
    .replace(/\\partial/g, ' partial ')
    .replace(/\\(left|right|mathrm|text|mathbf|vec|hat|bar|,|;|!|quad)/g, ' ')
    .replace(
      new RegExp(`\\\\(${GREEK.join('|')})(?![a-z])`, 'gi'),
      (_, name: string) => ` ${name} `,
    )
    .replace(/\\([A-Za-z]+)/g, ' $1 ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    // Inside math a hyphen is always a minus sign, spaced or not ("100-0").
    .replace(/-/g, ' minus ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/[{}\\$]/g, ' ');
  return (
    s
      // A fraction's parentheses are only needed around more than one word.
      .replace(/\(\s*([^\s()]+)\s*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

/** Text for read-aloud: math spans in words, everything else unchanged. */
// Markdown marks a reader would hear as "asterisk asterisk": emphasis, inline
// code, heading hashes, quote and list markers at the start of a line.
const stripMarkdown = (prose: string): string =>
  prose.replace(/(\*\*|__|\*|~~|`)/g, '').replace(/^\s{0,3}(#{1,6}|>|[-+]|\d+[.)])\s+/gm, '');

export const mathToSpeech = (text: string): string => {
  const segments = split(text);
  if (!segments.some((s) => s.math)) return stripMarkdown(text);
  return segments
    .map(({ text: raw, math }) => (math ? ` ${latexToWords(math.latex)} ` : stripMarkdown(raw)))
    .join('')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
};
