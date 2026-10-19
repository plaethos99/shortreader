import { describe, expect, test } from 'vitest';

import {
  chaptersFromHeadings,
  collectBlocks,
  isChapterHeading,
  isJunkChapter,
  partTitle,
  splitOversized,
  tocLooksBroken,
  type TextBlock,
} from '@/services/scrollfeed/structure';

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
const prose = (word: string, chars = 4000) =>
  `${word} ${'lorem ipsum dolor sit amet. '.repeat(chars / 28)}`;
const block = (text: string, heading = false, section = 0): TextBlock => ({
  section,
  text,
  heading,
});

describe('isChapterHeading', () => {
  test.each([
    'Chapter 12',
    'CHAPTER XII',
    'Chapter One',
    'Chapter 3: The Harbour',
    'Part Two',
    'Prologue',
    'EPILOGUE',
    'Глава 5',
    'ГЛАВА ВТОРАЯ',
    'Часть первая',
    'Kapitel 7',
    'Chapitre III',
    'Capítulo 4',
    'Rozdział 2',
    'अध्याय 3',
    'మొదటి అధ్యాయం',
    'అధ్యాయం 5',
    'அத்தியாயம் 2',
    'অধ্যায় ৪',
    '第三章',
    '第12章 旅立ち',
    '제3장',
    'الفصل الأول',
  ])('recognises %s', (text) => {
    expect(isChapterHeading(text)).toBe(true);
  });

  test.each([
    'Chapter 3 explains how the engine works in more detail than',
    'He read the chapter twice before he slept.',
    'The part of the town nobody visited',
    '',
    'Chapter',
  ])('rejects running prose: %s', (text) => {
    expect(isChapterHeading(text)).toBe(false);
  });
});

describe('collectBlocks', () => {
  test('one block per paragraph or heading, flagged when it is a heading tag', () => {
    const blocks = collectBlocks(
      parse('<h2>Chapter 1</h2><p>First <em>para</em>.</p><div>Second</div>'),
      3,
    );

    expect(blocks).toEqual([
      { section: 3, text: 'Chapter 1', heading: true },
      { section: 3, text: 'First para.', heading: false },
      { section: 3, text: 'Second', heading: false },
    ]);
  });

  // FB2 conversions and many EPUB generators mark headings by class, not tag.
  test('a paragraph inside a title/heading/chapter-classed element is a heading', () => {
    const blocks = collectBlocks(
      parse('<div class="title1"><p>1. Рэдрик Шухарт</p></div><p class="p1">Накануне.</p>'),
      0,
    );

    expect(blocks.map((b) => b.heading)).toEqual([true, false]);
  });

  // A PDF page is one text layer of one <span> per line.
  test('a PDF text layer yields one block per line', () => {
    const doc = parse(
      '<div class="textLayer"><span>CHAPTER 2</span><span>The sea was</span><span> </span><span>grey.</span></div>',
    );

    expect(collectBlocks(doc, 0).map((b) => b.text)).toEqual(['CHAPTER 2', 'The sea was', 'grey.']);
  });
});

describe('chaptersFromHeadings', () => {
  test('cuts the book at chapter-word headings, keeping front matter', () => {
    const chapters = chaptersFromHeadings([
      block(prose('preface')),
      block('Chapter 1'),
      block(prose('alpha')),
      block('Chapter 2'),
      block(prose('beta')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual(['Front matter', 'Chapter 1', 'Chapter 2']);
    expect(chapters![1]!.text).toContain('alpha');
    expect(chapters![1]!.text).not.toContain('beta');
  });

  // A contents page lists every chapter in a tight run; those lines are not
  // where the chapters start.
  test('ignores a contents page listing the chapters', () => {
    const chapters = chaptersFromHeadings([
      block('Contents'),
      block('Chapter 1'),
      block('Chapter 2'),
      block('Chapter 3'),
      block('Chapter 1'),
      block(prose('alpha')),
      block('Chapter 2'),
      block(prose('beta')),
      block('Chapter 3'),
      block(prose('gamma')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(chapters![0]!.text).toContain('alpha');
    expect(chapters![2]!.text).toContain('gamma');
  });

  // A PDF repeats the chapter name at the top of every page.
  test('a running header counts once, at its first appearance', () => {
    const chapters = chaptersFromHeadings([
      block('Chapter 1'),
      block(prose('alpha')),
      block('Chapter 1'),
      block(prose('alpha2')),
      block('Chapter 2'),
      block(prose('beta')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapters![0]!.text).toContain('alpha2');
  });

  test('falls back to heading tags when no chapter words are used', () => {
    const chapters = chaptersFromHeadings([
      block('The Harbour', true),
      block(prose('alpha')),
      block('The Storm', true),
      block(prose('beta')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual(['The Harbour', 'The Storm']);
  });

  // Old books and PDFs set titles in capitals, with no markup at all
  // (Annemann's Practical Mental Magic: "HEADLINE HUNTER ANNEMANN").
  test('falls back to all-caps title lines, ignoring the running header', () => {
    const chapters = chaptersFromHeadings([
      block('A DAY OF YOUR LIFE ANNEMANN'),
      block(prose('alpha')),
      block('PRACTICAL MENTAL MAGIC'),
      block(prose('alpha2')),
      block('HEADLINE HUNTER ANNEMANN'),
      block(prose('beta')),
      block('PRACTICAL MENTAL MAGIC'),
      block(prose('beta2')),
      block('I SAID NOTHING, OK.'),
      block(prose('gamma')),
      block('PRACTICAL MENTAL MAGIC'),
      block(prose('gamma2')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual([
      'A DAY OF YOUR LIFE ANNEMANN',
      'HEADLINE HUNTER ANNEMANN',
    ]);
    expect(chapters![0]!.text).toContain('alpha2');
  });

  // A title line straight after another is its byline or subtitle, not a
  // chapter of its own: "MENTAL HAT PIN" / "DR. JAKS".
  test('adjacent heading lines make one heading', () => {
    const chapters = chaptersFromHeadings([
      block('MENTAL HAT PIN'),
      block('DR. JAKS'),
      block(prose('alpha')),
      block('DEVIL DEVICE'),
      block(prose('beta')),
    ]);

    expect(chapters!.map((c) => c.title)).toEqual(['MENTAL HAT PIN · DR. JAKS', 'DEVIL DEVICE']);
  });

  test('accepts bare chapter numbers only when chapters come out long', () => {
    const numbered = chaptersFromHeadings([
      block('I'),
      block(prose('alpha', 9000)),
      block('II'),
      block(prose('beta', 9000)),
    ]);
    expect(numbered!.map((c) => c.title)).toEqual(['I', 'II']);

    // Page numbers: bare numerals a page apart are not chapters.
    const pages = chaptersFromHeadings(
      Array.from({ length: 6 }, (_, i) => [
        block(String(i + 1)),
        block(prose(`p${i}`, 2000)),
      ]).flat(),
    );
    expect(pages).toBeNull();
  });

  test('returns null when the text has no usable structure', () => {
    expect(chaptersFromHeadings([block(prose('alpha')), block(prose('beta'))])).toBeNull();
  });
});

describe('tocLooksBroken', () => {
  const ch = (title: string, chars: number) => ({ idx: 0, title, text: 'x'.repeat(chars) });

  test('a sensible TOC is left alone', () => {
    expect(tocLooksBroken([ch('One', 40000), ch('Two', 40000), ch('Three', 40000)], 120000)).toBe(
      false,
    );
  });

  test('one chapter swallowing most of a long book is broken', () => {
    expect(tocLooksBroken([ch('Front matter', 2000), ch('Book', 198000)], 200000)).toBe(true);
  });

  test('a long book with a single real chapter is broken', () => {
    expect(tocLooksBroken([ch('Front matter', 1000), ch('Only', 50000)], 51000)).toBe(true);
  });

  test('a short book may well be one chapter', () => {
    expect(tocLooksBroken([ch('Story', 20000)], 20000)).toBe(false);
  });
});

describe('isJunkChapter', () => {
  test.each([
    'Contents',
    'Table of Contents',
    'Index',
    'Copyright',
    'Оглавление',
    'Содержание',
    'विषय सूची',
    '目次',
    'Also by Jane Doe',
  ])('a chapter titled %s is not retold', (title) => {
    expect(isJunkChapter({ idx: 0, title, text: prose('x', 3000) })).toBe(true);
  });

  // A sparse TOC: its "Contents" entry is the last one, so it spans the whole
  // rest of the book. Dropping it dropped the book.
  test('a "Contents" entry that runs on through the book is kept', () => {
    expect(isJunkChapter({ idx: 0, title: '目录', text: prose('x', 90000) })).toBe(false);
  });

  test('an untitled contents page is recognised by its page numbers', () => {
    const text = Array.from(
      { length: 15 },
      (_, i) => `The Chapter Called ${i} ....... ${i * 12 + 3}`,
    ).join(' ');
    expect(isJunkChapter({ idx: 0, title: 'Front matter', text })).toBe(true);
  });

  test('a copyright page is recognised by its boilerplate', () => {
    const text =
      'Copyright © 2006 Stalker. All rights reserved. ISBN 966-696-346-9. Printed in Ukraine.';
    expect(isJunkChapter({ idx: 0, title: 'Front matter', text })).toBe(true);
  });

  test('story front matter is kept', () => {
    expect(
      isJunkChapter({
        idx: 0,
        title: 'Front matter',
        text: 'From an interview the Harmont radio correspondent took with Dr Valentine Pilman. '.repeat(
          40,
        ),
      }),
    ).toBe(false);
  });
});

describe('splitOversized', () => {
  test('splits a giant chapter at sentence ends into numbered parts, leaving others alone', () => {
    const giant = 'A sentence of the book. '.repeat(10000); // 240k chars
    const chapters = splitOversized([
      { idx: 0, title: 'Small', text: 'short. '.repeat(100) },
      { idx: 1, title: 'Whole book', text: giant },
    ]);

    expect(chapters[0]!.title).toBe('Small');
    const parts = chapters.slice(1);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.title).toBe(`Whole book (1/${parts.length})`);
    expect(parts.every((p) => p.text.endsWith('.'))).toBe(true);
    expect(chapters.map((c) => c.idx)).toEqual(chapters.map((_, i) => i));
  });
});

describe('partTitle', () => {
  test('names a part by its opening words', () => {
    expect(partTitle(2, '  The old harbour was quiet that winter morning, and the boats')).toBe(
      'Part 3 · The old harbour was quiet that winter…',
    );
  });
});
