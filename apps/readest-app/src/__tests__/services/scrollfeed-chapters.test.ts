import { describe, expect, test } from 'vitest';

import {
  extractChapters,
  isChapterAnchor,
  mergeShortChapters,
} from '@/services/scrollfeed/chapters';

const el = (html: string): Element => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.firstElementChild!;
};

describe('isChapterAnchor', () => {
  // Ponniyin Selvan's chapter anchors: <p> children of <body> whose text is the
  // title. Its glossary anchors: <span> inside a <p>, pointing mid-sentence.
  test('a block-level heading paragraph is a chapter boundary', () => {
    expect(isChapterAnchor(el('<p id="c1">The Adi Festival</p>'))).toBe(true);
  });

  test('an inline span inside a paragraph is a glossary reference', () => {
    const doc = new DOMParser().parseFromString(
      '<body><p>walls, <span id="g1">gopurams</span>, market places</p></body>',
      'text/html',
    );
    expect(isChapterAnchor(doc.getElementById('g1')!)).toBe(false);
  });

  test('a div wrapping a chapter counts, a div inside a list item does not', () => {
    expect(isChapterAnchor(el('<div id="c">Chapter One</div>'))).toBe(true);
    const doc = new DOMParser().parseFromString(
      '<body><li><div id="n">note</div></li></body>',
      'text/html',
    );
    expect(isChapterAnchor(doc.getElementById('n')!)).toBe(false);
  });

  // The bug that made a first attempt report zero chapters: el.closest('p')
  // matches a <p> heading against itself.
  test('a heading paragraph is not disqualified by matching itself', () => {
    const doc = new DOMParser().parseFromString('<body><p id="h">Title</p></body>', 'text/html');
    expect(isChapterAnchor(doc.getElementById('h')!)).toBe(true);
  });
});

describe('mergeShortChapters', () => {
  const long = (n: number) => 'x'.repeat(n);

  test('a part header folds into the chapter below it, keeping the later title', () => {
    const merged = mergeShortChapters([
      { idx: 0, title: 'The First Floods - Part 1', text: 'Part opener.' },
      { idx: 1, title: 'The Adi Festival', text: long(5000) },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('The Adi Festival');
    expect(merged[0]!.text.startsWith('Part opener.')).toBe(true);
  });

  test('consecutive short slices accumulate into the next real chapter', () => {
    const merged = mergeShortChapters([
      { idx: 0, title: 'Part 1', text: 'a' },
      { idx: 1, title: 'Part 1.1', text: 'b' },
      { idx: 2, title: 'Real', text: long(2000) },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('Real');
    expect(merged[0]!.text.startsWith('a b')).toBe(true);
  });

  test('a trailing short slice merges backwards instead', () => {
    const merged = mergeShortChapters([
      { idx: 0, title: 'Chapter', text: long(2000) },
      { idx: 1, title: 'Colophon', text: 'the end' },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('Chapter');
    expect(merged[0]!.text.endsWith('the end')).toBe(true);
  });

  test('indices are renumbered contiguously after merging', () => {
    const merged = mergeShortChapters([
      { idx: 0, title: 'Part', text: 'short' },
      { idx: 1, title: 'One', text: long(2000) },
      { idx: 2, title: 'Two', text: long(2000) },
    ]);

    expect(merged.map((c) => c.idx)).toEqual([0, 1]);
  });

  test('chapters already long enough pass through untouched', () => {
    const input = [
      { idx: 0, title: 'One', text: long(2000) },
      { idx: 1, title: 'Two', text: long(3000) },
    ];
    expect(mergeShortChapters(input)).toHaveLength(2);
  });
});

describe('extractChapters', () => {
  // A single-file book: one spine section, chapter titles as <p> siblings, with
  // a glossary <span> anchored mid-paragraph between them — the shape that broke
  // the old whole-section-per-entry extractor.
  const singleFileBook = () => {
    const body = `
      <p id="ch1">Chapter One</p>
      <p>The lamps along the quay had not yet been lit. ${'a'.repeat(1200)}</p>
      <p>Marlow sat cross-legged against the <span id="gloss">mizzen-mast</span>, waiting.</p>
      <p id="ch2">Chapter Two</p>
      <p>The sea reached out flat and grey. ${'b'.repeat(1200)}</p>
    `;
    const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
    return {
      sections: [{ createDocument: async () => doc }],
      toc: [
        { label: 'Chapter One', href: 'book.xhtml#ch1' },
        { label: 'Mizzen-mast', href: 'book.xhtml#gloss' },
        { label: 'Chapter Two', href: 'book.xhtml#ch2' },
      ],
      resolveHref: () => ({ index: 0 }),
    };
  };

  test('slices between chapter anchors and ignores the interleaved glossary ref', async () => {
    const chapters = await extractChapters(singleFileBook());

    expect(chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    // Chapter One keeps the glossary paragraph as its own body text, rather
    // than being truncated at the glossary anchor.
    expect(chapters[0]!.text).toContain('mizzen-mast');
    expect(chapters[0]!.text).not.toContain('The sea reached out');
    expect(chapters[1]!.text).toContain('The sea reached out');
  });

  // The commonest EPUB layout by far: one file per chapter, TOC hrefs with no
  // "#fragment". Requiring a fragment skipped every entry and dropped the book
  // to the spine fallback, so The Great Gatsby's feed listed "Section 2",
  // "Section 3" … while the reader's own sidebar showed Chapter 1-9.
  const multiFileBook = () => {
    const parse = (html: string) =>
      new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const docs = [
      parse(
        `<h1>Chapter 1</h1><p>In my younger and more vulnerable years. ${'a'.repeat(1500)}</p>`,
      ),
      parse(`<h1>Chapter 2</h1><p>About half way between West Egg. ${'b'.repeat(1500)}</p>`),
    ];
    return {
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'Chapter 1', href: 'ch1.xhtml' },
        { label: 'Chapter 2', href: 'ch2.xhtml' },
      ],
      resolveHref: (href: string) => ({ index: href === 'ch1.xhtml' ? 0 : 1 }),
    };
  };

  test('uses TOC titles for a book whose chapters are separate files', async () => {
    const chapters = await extractChapters(multiFileBook());

    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });

  test('a fragment-less entry takes the whole of its section, and only that', async () => {
    const chapters = await extractChapters(multiFileBook());

    expect(chapters[0]!.text).toContain('In my younger and more vulnerable years');
    expect(chapters[0]!.text).not.toContain('About half way between West Egg');
    expect(chapters[1]!.text).toContain('About half way between West Egg');
  });

  const parse = (html: string) =>
    new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const filler = (tag: string) => `${tag} ${'x'.repeat(1500)}`;

  // A chapter is the span from its anchor to the NEXT anchor, in spine order —
  // not the one file the anchor happens to sit in. Large EPUBs split a chapter
  // across several XHTML files and list only the first in the TOC; taking that
  // file alone silently dropped the rest of the chapter, and any section with
  // no TOC entry at all disappeared from the feed.
  test('a chapter spans every section up to the next TOC anchor', async () => {
    const docs = [
      parse(`<h1>One</h1><p>${filler('alpha')}</p>`),
      parse(`<p>${filler('beta')}</p>`),
      parse(`<h1>Two</h1><p>${filler('gamma')}</p>`),
      parse(`<p>${filler('delta')}</p>`),
    ];
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'One', href: 's0.xhtml' },
        { label: 'Two', href: 's2.xhtml' },
      ],
      resolveHref: (href: string) => ({ index: href === 's0.xhtml' ? 0 : 2 }),
    });

    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(chapters[0]!.text).toContain('alpha');
    expect(chapters[0]!.text).toContain('beta');
    expect(chapters[0]!.text).not.toContain('gamma');
    expect(chapters[1]!.text).toContain('gamma');
    // Sections after the last anchor belong to the last chapter.
    expect(chapters[1]!.text).toContain('delta');
  });

  // PDF outlines: foliate gives one section per PAGE and TOC items carrying a
  // numeric page `index` with no href. Requiring an href made every entry
  // unresolvable, and the per-page fallback listed a 300-page book as 300
  // "chapters".
  test('PDF-style entries with a page index span the pages to the next entry', async () => {
    const pages = ['alpha', 'beta', 'gamma', 'delta'].map((w) => parse(`<p>${filler(w)}</p>`));
    const chapters = await extractChapters({
      sections: pages.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'Chapter 1', index: 0 },
        { label: 'Chapter 2', index: 2 },
      ],
    });

    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapters[0]!.text).toContain('beta');
    expect(chapters[1]!.text).toContain('delta');
  });

  // A PDF page's text layer (foliate/pdf.js) is one <span> per line with no
  // <br> between lines; words within a line get explicit " " spans. Plain
  // textContent glued lines together ("They called menymph"), so the model's
  // correctly-spaced verbatim quotes never matched and nearly every card was
  // dropped — a 10-card chapter came back as 1 card.
  test('PDF text-layer lines are separated by a space, hyphenated line ends stay joined', async () => {
    const page = parse(
      '<div id="canvas"></div><div class="textLayer">' +
        '<span>They called me</span><span>nymph, the high-</span>' +
        '<span>arched halls</span><span> </span><span>were ours.</span>' +
        `<span>${filler('tail')}</span></div>`,
    );
    const chapters = await extractChapters({
      sections: [{ createDocument: async () => page }],
      toc: [{ label: 'Chapter One', index: 0 }],
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.text).toContain('They called me nymph, the high-arched halls were ours.');
    expect(chapters[0]!.text).not.toContain('menymph');
  });

  test('front matter before the first anchor is kept, not dropped', async () => {
    const doc = parse(
      `<p>${filler('preface')}</p><p id="c1">Chapter One</p><p>${filler('alpha')}</p>`,
    );
    const chapters = await extractChapters({
      sections: [{ createDocument: async () => doc }],
      toc: [{ label: 'Chapter One', href: 'book.xhtml#c1' }],
      resolveHref: () => ({ index: 0 }),
    });

    expect(chapters.map((c) => c.title)).toEqual(['Front matter', 'Chapter One']);
    expect(chapters[0]!.text).toContain('preface');
    expect(chapters[1]!.text).not.toContain('preface');
  });

  // No TOC at all (or a PDF with no outline): one "chapter" per spine section
  // is one per PAGE for a PDF. Group consecutive sections into readable parts
  // instead, losing nothing.
  test('with no TOC, small sections are grouped into parts rather than listed one per page', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => parse(`<p>${filler(`page${i}`)}</p>`));
    const chapters = await extractChapters({
      sections: pages.map((d) => ({ createDocument: async () => d })),
      toc: [],
    });

    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters.length).toBeLessThan(12);
    const all = chapters.map((c) => c.text).join(' ');
    expect(all).toContain('page0');
    expect(all).toContain('page11');
  });

  // One bad TOC entry must cost one entry, not the book. foliate's resolveHref
  // throws on hrefs it can't parse (seen with odd MOBI and PDF outlines), and
  // an unhandled throw here surfaced as "Could not read book." for the whole
  // title — a feed with nothing in it.
  test('a TOC entry whose href cannot be resolved is skipped, not fatal', async () => {
    const docs = [
      parse(`<h1>One</h1><p>${filler('alpha')}</p>`),
      parse(`<h1>Two</h1><p>${filler('beta')}</p>`),
    ];
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'One', href: 's0.xhtml' },
        { label: 'Broken', href: 'kindle:pos:fid:0001' },
        { label: 'Two', href: 's1.xhtml' },
      ],
      resolveHref: (href: string) => {
        if (href.startsWith('kindle:')) throw new Error('unresolvable');
        return { index: href === 's0.xhtml' ? 0 : 1 };
      },
    });

    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
  });

  test('a section whose document fails to load is skipped, not fatal', async () => {
    const good = parse(`<h1>One</h1><p>${filler('alpha')}</p>`);
    const chapters = await extractChapters({
      sections: [
        { createDocument: async () => good },
        {
          createDocument: async () => {
            throw new Error('corrupt entry');
          },
        },
      ],
      toc: [],
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.text).toContain('alpha');
  });

  test('falls back to one chapter per section when the TOC resolves to nothing', async () => {
    const doc = new DOMParser().parseFromString(
      `<body><p>${'text '.repeat(300)}</p></body>`,
      'text/html',
    );
    const chapters = await extractChapters({
      sections: [{ createDocument: async () => doc }],
      toc: [],
      resolveHref: () => null,
    });

    expect(chapters).toHaveLength(1);
    // Named by its opening words, not "Section 1".
    expect(chapters[0]!.title).toBe('Part 1 · text text text text text text text…');
  });

  // Books without a usable TOC: the chapters are found in the text itself,
  // whatever the format — these are plain section documents either way.
  const prose = (word: string) => `${word} ${'lorem ipsum dolor sit amet. '.repeat(250)}`;

  test('with no TOC, chapters come from the headings in the text', async () => {
    const docs = [
      parse(`<p>Глава 1</p><p>${prose('alpha')}</p>`),
      parse(`<p>${prose('alpha-more')}</p><p>Глава 2</p><p>${prose('beta')}</p>`),
    ];
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [],
    });

    expect(chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2']);
    expect(chapters[0]!.text).toContain('alpha-more');
    expect(chapters[1]!.text).toContain('beta');
  });

  test('a TOC with one entry for the whole book is replaced by the headings inside it', async () => {
    const body = Array.from(
      { length: 6 },
      (_, i) => `<h2>Chapter ${i + 1}</h2><p>${prose(`w${i}`)}</p>`,
    ).join('');
    const doc = parse(body);
    const chapters = await extractChapters({
      sections: [{ createDocument: async () => doc }],
      toc: [{ label: 'The Book', href: 'book.xhtml' }],
      resolveHref: () => ({ index: 0 }),
    });

    expect(chapters.map((c) => c.title)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
      'Chapter 4',
      'Chapter 5',
      'Chapter 6',
    ]);
  });

  test('contents and copyright pages are not offered as chapters', async () => {
    const docs = [
      parse('<p>Copyright © 2006. All rights reserved. ISBN 966-696-346-9.</p>'),
      parse('<h1>Contents</h1><p>One ..... 3</p>'),
      parse(`<h1>One</h1><p>${filler('alpha')}</p>`),
      parse(`<h1>Two</h1><p>${filler('beta')}</p>`),
    ];
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'Copyright', href: 's0' },
        { label: 'Contents', href: 's1' },
        { label: 'One', href: 's2' },
        { label: 'Two', href: 's3' },
      ],
      resolveHref: (href: string) => ({ index: Number(href.slice(1)) }),
    });

    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(chapters[0]!.text).not.toContain('ISBN');
  });

  // The Satanic Verses: every part restarts at "Chapter 1". A list of five
  // "Chapter 1"s says nothing; the part's name tells them apart.
  test('a chapter name repeated across parts is prefixed with its part', async () => {
    const docs = [0, 1, 2, 3].map((i) => parse(`<p>${filler(`s${i}`)}</p>`));
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: [
        { label: 'I The Angel', href: 's0', subitems: [{ label: 'Chapter 1', href: 's1' }] },
        { label: 'II Mahound', href: 's2', subitems: [{ label: 'Chapter 1', href: 's3' }] },
      ],
      resolveHref: (href: string) => ({ index: Number(href.slice(1)) }),
    });

    expect(chapters.map((c) => c.title)).toEqual([
      'I The Angel',
      'I The Angel · Chapter 1',
      'II Mahound',
      'II Mahound · Chapter 1',
    ]);
  });

  // The same book's PDF outline is flat: parts and chapters are siblings.
  test('in a flat TOC a repeated name takes the part listed before it', async () => {
    const docs = [0, 1, 2, 3, 4].map((i) => parse(`<p>${filler(`s${i}`)}</p>`));
    const chapters = await extractChapters({
      sections: docs.map((d) => ({ createDocument: async () => d })),
      toc: ['Epigraph', 'Chapter 1', 'Chapter 2', 'II Mahound', 'Chapter 1'].map((label, i) => ({
        label,
        index: i,
      })),
    });

    expect(chapters.map((c) => c.title)).toEqual([
      'Epigraph',
      'Chapter 1',
      'Chapter 2',
      'II Mahound',
      'II Mahound · Chapter 1',
    ]);
  });

  // A scanned book: every page a picture. Its chapters are page ranges whose
  // text is read (OCR) only when the chapter is opened.
  const scanned = (n: number) =>
    Array.from({ length: n }, () => ({
      createDocument: async () => parse('<div id="canvas"></div><div class="textLayer"></div>'),
    }));

  test('a scanned book without an outline is split into page ranges to read on open', async () => {
    const chapters = await extractChapters({ sections: scanned(25), toc: [] });

    expect(chapters.map((c) => c.title)).toEqual(['Pages 1–10', 'Pages 11–20', 'Pages 21–25']);
    expect(chapters[0]!.text).toBe('');
    expect(chapters[2]!.scannedSections).toEqual([20, 21, 22, 23, 24]);
  });

  // foliate's CBZ sections are bare images: load/unload, no document, and a
  // TOC that lists every image file. Old books are often shared this way.
  test('a comic-style book of page images is read as scanned pages, not one chapter per file', async () => {
    const files = Array.from({ length: 12 }, (_, i) => `page${i + 1}.jpg`);
    const chapters = await extractChapters({
      sections: files.map((id) => ({ id, load: async () => `blob:${id}`, unload: () => {} })),
      toc: files.map((name) => ({ label: name, href: name })),
      resolveHref: (href: string) => ({ index: files.indexOf(href) }),
    });

    expect(chapters.map((c) => c.title)).toEqual(['Pages 1–10', 'Pages 11–12']);
  });

  test("a scanned book's outline still names its chapters", async () => {
    const chapters = await extractChapters({
      sections: scanned(12),
      toc: [
        { label: 'Chapter 1', index: 2 },
        { label: 'Chapter 2', index: 7 },
      ],
    });

    expect(chapters.map((c) => c.title)).toEqual(['Front matter', 'Chapter 1', 'Chapter 2']);
    expect(chapters[1]!.scannedSections).toEqual([2, 3, 4, 5, 6]);
    expect(chapters[2]!.scannedSections).toEqual([7, 8, 9, 10, 11]);
  });
});
