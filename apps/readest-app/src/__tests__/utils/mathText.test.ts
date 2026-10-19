import { describe, expect, test } from 'vitest';

import {
  hasMath,
  mathToSpeech,
  renderInlineMarkdownMath,
  renderMarkdownMath,
  renderMathText,
} from '@/utils/mathText';

describe('renderMathText', () => {
  test('leaves text without math as plain, escaped text', () => {
    const html = renderMathText('Velocity is <b>distance</b> over time & more.');

    expect(html).not.toContain('<math');
    expect(html).toContain('&lt;b&gt;distance&lt;/b&gt;');
    expect(html).toContain('&amp; more');
  });

  test('renders inline $...$ as MathML', () => {
    const html = renderMathText('Speed is $v = \\frac{d}{t}$ here.');

    expect(html).toContain('<math');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('Speed is ');
    expect(html).toContain(' here.');
  });

  test('renders display $$...$$ and \\[...\\] as block math', () => {
    expect(renderMathText('$$E = mc^2$$')).toContain('display="block"');
    expect(renderMathText('\\[F = ma\\]')).toContain('display="block"');
  });

  test('renders inline \\(...\\)', () => {
    const html = renderMathText('Force \\(F = ma\\) acts.');
    expect(html).toContain('<math');
    expect(html).not.toContain('display="block"');
  });

  // The cards arrive as JSON, where \f \t \b are escapes: an unescaped
  // "\frac" decodes to a form feed + "rac", "\theta" to a tab + "heta".
  test('repairs LaTeX commands mangled by JSON escapes', () => {
    const formFeedFrac = renderMathText('$rac{a}{b}$');
    expect(formFeedFrac).toContain('<mfrac>');

    const tabTheta = renderMathText('$	heta$');
    expect(tabTheta).toContain('θ');

    const newlineNabla = renderMathText('$\nabla \\cdot E$');
    expect(newlineNabla).toContain('∇');

    // "\beta" decodes to a backspace + "eta".
    const backspaceBeta = renderMathText(`$${String.fromCharCode(8)}eta$`);
    expect(backspaceBeta).toContain('β');
  });

  test('prices are not mistaken for math', () => {
    expect(renderMathText('It cost $5 and then $10 more.')).not.toContain('<math');
  });

  test('bad LaTeX renders instead of throwing', () => {
    expect(() => renderMathText('$\\frac{a$')).not.toThrow();
  });

  test('strips anything executable', () => {
    const html = renderMathText('<img src=x onerror=alert(1)> $\\href{javascript:alert(1)}{x}$');

    // Checked on the parsed DOM: escaped text such as "&lt;img onerror=...&gt;"
    // is harmless words, not an element or an attribute.
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    expect(doc.querySelector('img, a, script')).toBeNull();
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith('on')).toBe(false);
        expect(attr.value).not.toMatch(/^\s*javascript:/i);
      }
    }
  });
});

describe('hasMath', () => {
  test('detects each delimiter style and ignores plain text', () => {
    expect(hasMath('a $x^2$ b')).toBe(true);
    expect(hasMath('$$x$$')).toBe(true);
    expect(hasMath('\\(x\\)')).toBe(true);
    expect(hasMath('\\[x\\]')).toBe(true);
    expect(hasMath('no math, $5 only')).toBe(false);
  });
});

// Read-aloud must not pronounce "dollar backslash frac".
describe('mathToSpeech', () => {
  test('turns common notation into words and drops the markup', () => {
    const spoken = mathToSpeech('Speed is $v = \\frac{d}{t}$ and $E = mc^2$.');

    expect(spoken).toContain('v equals d over t');
    expect(spoken).toContain('E equals mc squared');
    expect(spoken).not.toMatch(/[$\\{}]/);
  });

  test('reads Greek letters, roots, products and powers', () => {
    const spoken = mathToSpeech('$\\omega = 2\\pi f$, $\\sqrt{x}$, $a \\times b$, $x^{n}$');

    expect(spoken).toContain('omega equals 2 pi f');
    expect(spoken).toContain('square root of x');
    expect(spoken).toContain('a times b');
    expect(spoken).toContain('x to the power n');
  });

  // Real DeepSeek output for a physics chapter (Fundamentals of Physics, ch. 2).
  test('reads subscripts with text labels, unspaced minus signs and limits', () => {
    expect(mathToSpeech('$v_{\\text{avg}} = \\frac{x_2 - x_1}{t_2 - t_1}$')).toContain(
      'v sub avg equals',
    );
    // Grouped, so "(a minus b) over (c minus d)" is not heard as a minus b over c.
    expect(mathToSpeech('$\\frac{100-0}{20-0} = 5$')).toContain(
      '(100 minus 0) over (20 minus 0) equals 5',
    );
    expect(mathToSpeech('$v = \\lim_{\\Delta t \\to 0} \\frac{\\Delta x}{\\Delta t}$')).toContain(
      'the limit as Delta t goes to 0 of',
    );
  });

  test('leaves text without math alone', () => {
    expect(mathToSpeech('Plain prose.')).toBe('Plain prose.');
  });
});

describe('renderMarkdownMath', () => {
  test('renders an AI reply’s Markdown: bold, lists, headings', () => {
    const html = renderMarkdownMath('## Key ideas\n\n- **Speed** is distance\n- Time *matters*');

    expect(html).toContain('<h2>Key ideas</h2>');
    expect(html).toContain('<li><strong>Speed</strong> is distance</li>');
    expect(html).toContain('<em>matters</em>');
  });

  test('keeps LaTeX out of the Markdown pass', () => {
    const html = renderMarkdownMath('**Average speed:** $v_{avg} = \frac{d}{t}$ and $a_1 * b_2$');

    expect(html).toContain('<strong>Average speed:</strong>');
    expect(html.match(/<math/g)).toHaveLength(2);
    expect(html).not.toContain('MATHSLOT');
    expect(html).not.toContain('<em>');
  });

  test('drops scripts and links from model output', () => {
    const html = renderMarkdownMath('Hi <script>alert(1)</script> [x](javascript:alert(1))');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
  });
});

describe('renderInlineMarkdownMath', () => {
  test('applies inline marks without wrapping in a paragraph', () => {
    expect(renderInlineMarkdownMath('A **bold** theme')).toBe('A <strong>bold</strong> theme');
  });
});

describe('mathToSpeech and Markdown', () => {
  test('does not read Markdown marks aloud', () => {
    expect(mathToSpeech('## Ideas\n- **Speed** is `fast`\n1. Then *time*')).toBe(
      'Ideas\nSpeed is fast\nThen time',
    );
  });
});
