/**
 * Finding a book's real structure when its TOC doesn't give it.
 *
 * Many books arrive with no TOC, a TOC with one entry for the whole book, or a
 * PDF with no outline. The feed then listed arbitrary "Section N" slices that
 * started mid-story, one giant "chapter", and front-matter junk (contents,
 * copyright) retold as if it were the story. These helpers read the text itself:
 * chapter headings in any of the languages the app serves, heading tags, and as
 * a last resort bare chapter numbers. Everything here works on plain text
 * blocks, so it applies equally to EPUB, MOBI/AZW3, FB2, PDF, TXT and HTML —
 * every format reaches the feed as foliate section documents.
 */
import type { FeedChapter } from './chapters';
import { segmentChapter } from './segments';

export const FRONT_MATTER = 'Front matter';

export interface TextBlock {
  section: number;
  text: string;
  // An <h1>-<h6>: a heading by markup, whatever it says.
  heading: boolean;
}

const BLOCK_SELECTOR =
  'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,dt,dd,div,section,article,header,footer,figcaption,caption,aside,body';

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The element a text node's line belongs to: a PDF text-layer line (one
 * <span> per line), else the nearest block element. */
const blockOf = (node: Node, body: HTMLElement): Element => {
  const parent = node.parentElement ?? body;
  const layer = parent.closest('.textLayer');
  if (layer) {
    let line: Element = parent;
    while (line.parentElement && line.parentElement !== layer) line = line.parentElement;
    return line;
  }
  return parent.closest(BLOCK_SELECTOR) ?? body;
};

// FB2 conversions (<div class="title1">), Calibre and most EPUB generators
// mark headings by class rather than tag.
const HEADING_CLASS = '[class*="title" i], [class*="head" i], [class*="chapter" i]';

const isHeadingElement = (el: Element): boolean =>
  /^H[1-6]$/i.test(el.tagName) || (el.tagName !== 'BODY' && !!el.closest(HEADING_CLASS));

/** A section's text as blocks — paragraphs and headings, or PDF lines — in
 * document order. */
export const collectBlocks = (doc: Document, section: number): TextBlock[] => {
  const body = doc.body;
  if (!body) return [];
  const blocks: TextBlock[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let current: Element | null = null;
  let buffer = '';
  const flush = () => {
    const text = normalize(buffer);
    if (current && text) blocks.push({ section, text, heading: isHeadingElement(current) });
    buffer = '';
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = blockOf(node, body);
    if (block !== current) {
      flush();
      current = block;
    }
    buffer += (node as Text).data;
  }
  flush();
  return blocks;
};

// Words that open a chapter heading ("Chapter 3", "Глава вторая", "అధ్యాయం 5",
// or number-first as Indian languages often write it: "మొదటి అధ్యాయం").
const CHAPTER_WORDS = [
  'chapter',
  'part',
  'book',
  'act',
  'canto',
  'глава',
  'часть',
  'книга',
  'розділ',
  'частина',
  'kapitel',
  'teil',
  'buch',
  'chapitre',
  'partie',
  'livre',
  'capítulo',
  'capitulo',
  'capitolo',
  'parte',
  'libro',
  'livro',
  'hoofdstuk',
  'deel',
  'rozdział',
  'część',
  'bölüm',
  'kısım',
  'अध्याय',
  'भाग',
  'प्रकरण',
  'অধ্যায়',
  'পরিচ্ছেদ',
  'পর্ব',
  'అధ్యాయం',
  'భాగం',
  'ప్రకరణం',
  'அத்தியாயம்',
  'பாகம்',
  'அதிகாரம்',
  'ಅಧ್ಯಾಯ',
  'ಭಾಗ',
  'അധ്യായം',
  'അദ്ധ്യായം',
  'ഭാഗം',
  'અધ્યાય',
  'પ્રકરણ',
  'ભાગ',
  'باب',
  'فصل',
  'حصہ',
  'الفصل',
  'الباب',
].join('|');

// Headings that stand alone as a whole line.
const STANDALONE = [
  'prologue',
  'epilogue',
  'prolog',
  'epilog',
  'preface',
  'foreword',
  'introduction',
  'afterword',
  'interlude',
  'пролог',
  'эпилог',
  'предисловие',
  'послесловие',
  'вступление',
  'введение',
  'prólogo',
  'epílogo',
  'prologo',
  'epilogo',
  'vorwort',
  'nachwort',
  'einleitung',
  'préface',
  'avant-propos',
  'postface',
  'भूमिका',
  'प्रस्तावना',
  'ముందుమాట',
  'ఉపోద్ఘాతం',
  'முன்னுரை',
  'முகவுரை',
  'ভূমিকা',
  '序章',
  '終章',
  '序言',
  '前言',
  '后记',
  '後記',
].join('|');

// "Chapter 3", "Chapter One", "Chapter 3: The Harbour" — a word after the
// keyword, then nothing or a separator and a title. "Chapter 3 explains how…"
// is prose, not a heading.
const KEYWORD_FIRST = new RegExp(
  `^(?:${CHAPTER_WORDS})\\s+\\S{1,20}(?:\\s*[.:\\-–—]\\s*.*)?$`,
  'iu',
);
const KEYWORD_LAST = new RegExp(`^\\S{1,20}\\s+(?:${CHAPTER_WORDS})$`, 'iu');
const STANDALONE_RE = new RegExp(`^(?:${STANDALONE})[.:]?$`, 'iu');
const CJK = /^第[\d一二三四五六七八九十百千零〇两]+[章回节節部卷篇](?:\s.*)?$/u;
const KOREAN = /^제\s*\d+\s*[장부편](?:\s.*)?$/u;
const BARE_NUMBER = /^(?:\d{1,3}|[IVXLC]{1,8})\.?$/;

const MAX_HEADING_CHARS = 80;
const MAX_MARKUP_HEADING_CHARS = 160;

export const isChapterHeading = (text: string): boolean => {
  const line = normalize(text);
  if (!line || line.length > MAX_HEADING_CHARS) return false;
  return (
    KEYWORD_FIRST.test(line) ||
    KEYWORD_LAST.test(line) ||
    STANDALONE_RE.test(line) ||
    CJK.test(line) ||
    KOREAN.test(line)
  );
};

/** Join blocks as the chapter text; a PDF line ending in "-" continues the
 * word on the next line. */
const joinBlocks = (blocks: TextBlock[]): string =>
  normalize(
    blocks.reduce(
      (out, b) => (out.endsWith('-') ? `${out}${b.text}` : out ? `${out} ${b.text}` : b.text),
      '',
    ),
  );

// Headings compare as the same line whatever their spacing and case.
const key = (block: TextBlock): string => normalize(block.text).toLowerCase();

// Headings closer than this are a list of them — a contents page — not the
// starts of chapters.
const CLUSTER_GAP_CHARS = 300;

/** Drop runs of 3+ headings packed together (a contents page). The last of a
 * run survives when it repeats an earlier entry: that is the first chapter's
 * real heading, straight after the contents page. */
const dropContentsClusters = (candidates: number[], offsets: number[], blocks: TextBlock[]) => {
  const kept: number[] = [];
  let run: number[] = [];
  const closeRun = () => {
    if (run.length < 3) {
      kept.push(...run);
    } else {
      const last = run[run.length - 1]!;
      if (run.slice(0, -1).some((i) => key(blocks[i]!) === key(blocks[last]!))) kept.push(last);
    }
    run = [];
  };
  for (const i of candidates) {
    const prev = run[run.length - 1];
    if (prev !== undefined && offsets[i]! - offsets[prev + 1]! >= CLUSTER_GAP_CHARS) closeRun();
    run.push(i);
  }
  closeRun();
  return kept;
};

/** A heading repeated down the book — a PDF's running header — marks its
 * chapter where it first appears. */
const firstOccurrences = (candidates: number[], blocks: TextBlock[]) => {
  const seen = new Set<string>();
  return candidates.filter((i) => {
    const text = key(blocks[i]!);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
};

// Shorter front matter is a label or a title line, not text to retell.
const MIN_FRONT_CHARS = 200;

const RUNNING_HEADER_REPEATS = 3;

interface Tier {
  test: (block: TextBlock) => boolean;
  // A line repeated down the book is a running header. "Chapter 3" atop
  // every page of chapter 3 still marks where it starts; a book title in
  // capitals atop every page marks nothing.
  repeatsAreHeaders?: boolean;
  // Below this average chapter length the "headings" are something else:
  // bare numbers a page apart are page numbers.
  minAverageChars: number;
}

/** A title line set in capitals — how old books and PDFs mark their titles
 * when there is no markup ("HEADLINE HUNTER ANNEMANN"). Two words at least,
 * and not a shouted sentence. Scripts without case never match. */
const isCapsTitle = (text: string): boolean => {
  if (text.length > MAX_HEADING_CHARS || !/\s/.test(text) || /[.,;!?]$/.test(text)) return false;
  const letters = text.match(/\p{L}/gu) ?? [];
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  const cased = letters.filter((c) => c.toLowerCase() !== c.toUpperCase()).length;
  return letters.length >= 6 && cased === letters.length && upper / cased >= 0.9;
};

const TIERS: Tier[] = [
  { test: (b) => isChapterHeading(b.text), minAverageChars: 0 },
  // Marked-up headings may run long: "1. Рэдрик Шухарт, 23 года, холост,
  // лаборант Хармонтского филиала Международного института…" is 105 chars.
  {
    test: (b) => b.heading && b.text.length <= MAX_MARKUP_HEADING_CHARS,
    repeatsAreHeaders: true,
    minAverageChars: 1500,
  },
  { test: (b) => isCapsTitle(b.text), repeatsAreHeaders: true, minAverageChars: 1500 },
  { test: (b) => BARE_NUMBER.test(b.text), minAverageChars: 8000 },
];

/**
 * Chapters found in the text itself, or null when it shows no structure.
 * Tries chapter-word headings first, then heading tags, then bare numbers.
 * Text before the first heading is kept as front matter.
 */
export const chaptersFromHeadings = (blocks: TextBlock[]): FeedChapter[] | null => {
  const offsets: number[] = [0];
  for (const b of blocks) offsets.push(offsets[offsets.length - 1]! + b.text.length + 1);

  for (const tier of TIERS) {
    let found = blocks.flatMap((b, i) => (tier.test(b) ? [i] : []));
    if (tier.repeatsAreHeaders) {
      const counts = new Map<string, number>();
      for (const i of found) counts.set(key(blocks[i]!), (counts.get(key(blocks[i]!)) ?? 0) + 1);
      found = found.filter((i) => counts.get(key(blocks[i]!))! < RUNNING_HEADER_REPEATS);
    }
    const kept = dropContentsClusters(found, offsets, blocks);
    const deduped = firstOccurrences(kept, blocks);
    // A heading line straight after another continues it (a byline, a
    // subtitle, "PART ONE" over "CHAPTER 1"): one chapter, both in its title.
    const starts = deduped.filter((i, n) => deduped[n - 1] !== i - 1);
    const titleOf = (start: number) => {
      const lines = [blocks[start]!.text];
      for (let i = start + 1; deduped.includes(i); i++) lines.push(blocks[i]!.text);
      return lines.join(' · ');
    };
    if (starts.length < 2) continue;

    // The contents list itself is not front matter worth retelling, and what
    // is left of it ("Contents", a title line) is no chapter either.
    const contents = new Set(found.filter((i) => !kept.includes(i)));
    const chapters: FeedChapter[] = [];
    const front = joinBlocks(blocks.slice(0, starts[0]).filter((_, i) => !contents.has(i)));
    if (front.length >= MIN_FRONT_CHARS)
      chapters.push({ idx: 0, title: FRONT_MATTER, text: front });
    for (const [n, start] of starts.entries()) {
      chapters.push({
        idx: chapters.length,
        title: titleOf(start),
        text: joinBlocks(blocks.slice(start, starts[n + 1])),
      });
    }
    const body = chapters.filter((c) => c.title !== FRONT_MATTER);
    const average = body.reduce((n, c) => n + c.text.length, 0) / body.length;
    if (average >= tier.minAverageChars) return chapters;
  }
  return null;
};

/** A TOC that doesn't structure the book: a long book with one real chapter,
 * or one chapter holding most of it. */
export const tocLooksBroken = (chapters: FeedChapter[], totalChars: number): boolean => {
  if (totalChars < 30000) return false;
  if (chapters.filter((c) => c.title !== FRONT_MATTER).length < 2) return true;
  const largest = Math.max(...chapters.map((c) => c.text.length));
  return totalChars >= 60000 && largest > 0.6 * totalChars;
};

const JUNK_TITLE =
  /^(?:(?:table of )?contents|index|copyright.*|also by.*|other books by.*|about the (?:author|publisher)|acknowledge?ments?|bibliography|оглавление|содержание|inhalt(?:sverzeichnis)?|table des matières|sommaire|índice|indice|contenidos?|sumário|inhoud(?:sopgave)?|spis treści|目次|目录|目錄|차례|목차|विषय[ -]?सूची|अनुक्रमणिका|সূচিপত্র|సూచిక|విషయ సూచిక|பொருளடக்கம்|ಪರಿವಿಡಿ|ഉള്ളടക്കം|અનુક્રમણિકા|فہرست|المحتويات|فهرست)$/iu;

const MAX_JUNK_CHARS = 20000;

// A contents entry: some words, dot leaders or spaces, a page number.
const CONTENTS_ENTRY = /[^\d\s][^\d]{2,80}?[\s.·…_]+\d{1,4}(?=\s|$)/gu;

const COPYRIGHT_SIGNS = [
  /©|\(c\)\s*\d{4}/i,
  /\bISBN\b/i,
  /all rights reserved|все права защищены|tous droits réservés|todos los derechos reservados|alle rechte vorbehalten/i,
  /\bprinted in\b|отпечатано/i,
  /library of congress|ББК|УДК/i,
  /\bcopyright\b/i,
];

/** Pages that aren't the book's content: contents, index, copyright and the
 * like. Retelling them produced cards summarising a list of chapter titles. */
export const isJunkChapter = (chapter: FeedChapter): boolean => {
  const { text } = chapter;
  // Past this it is more than the page its title names: a sparse TOC whose
  // "Contents" entry runs on through the rest of the book.
  if (text.length >= MAX_JUNK_CHARS) return false;
  const title = normalize(chapter.title).replace(/[.:]+$/, '');
  if (JUNK_TITLE.test(title)) return true;
  const entries = text.match(CONTENTS_ENTRY)?.length ?? 0;
  const tokens = text.split(/\s+/).filter(Boolean);
  const numbers = tokens.filter((t) => /^\d{1,4}$/.test(t)).length;
  if (entries >= 8 && numbers / Math.max(1, tokens.length) >= 0.1) return true;
  return text.length < 6000 && COPYRIGHT_SIGNS.filter((re) => re.test(text)).length >= 2;
};

/** Drop junk chapters, unless that would leave nothing. */
export const dropJunk = (chapters: FeedChapter[]): FeedChapter[] => {
  const kept = chapters.filter((c) => !isJunkChapter(c));
  return (kept.length ? kept : chapters).map((c, idx) => ({ ...c, idx }));
};

// Past this a "chapter" is not one a reader would recognise: the whole book
// under a single TOC entry. Well-formed chapters are far below it and are
// left exactly as they are.
const OVERSIZED_CHARS = 150000;
const OVERSIZED_PART_CHARS = 60000;

/** Split giant chapters into numbered parts at sentence ends. */
export const splitOversized = (chapters: FeedChapter[]): FeedChapter[] =>
  chapters
    .flatMap((c) => {
      if (c.text.length <= OVERSIZED_CHARS) return [c];
      const parts = segmentChapter(c.text, OVERSIZED_PART_CHARS);
      return parts.map((text, i) => ({
        ...c,
        title: `${c.title} (${i + 1}/${parts.length})`,
        text,
      }));
    })
    .map((c, idx) => ({ ...c, idx }));

const PART_TITLE_WORDS = 7;
const PART_TITLE_MAX_CHARS = 48;

/** A title for a stretch of text with no heading: its opening words, so the
 * list reads as the book rather than "Section 1, Section 2…". */
export const partTitle = (index: number, text: string): string => {
  const words = normalize(text).split(' ');
  let opening = words.slice(0, PART_TITLE_WORDS).join(' ').slice(0, PART_TITLE_MAX_CHARS);
  opening = opening.replace(/[\s,;:.!?—–-]+$/, '');
  const more = words.length > PART_TITLE_WORDS || opening.length < normalize(text).length;
  return `Part ${index + 1} · ${opening}${more ? '…' : ''}`;
};
