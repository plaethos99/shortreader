/**
 * Chapter extraction for the feed.
 *
 * `luminaBookText.extractBookText` assigns each TOC entry the WHOLE text of the
 * spine section it resolves to. That is fine for one-file-per-chapter books and
 * useless for single-file ones: Ponniyin Selvan is a single 3.34M-character
 * XHTML file whose 510 TOC entries all resolve to the same section, so every
 * "chapter" came back as the entire book.
 *
 * This extractor slices between TOC anchors instead. Measured on that book:
 * 510 TOC entries -> 377 chapters + 133 glossary refs dropped, median chapter
 * 8.8k chars, slices tiling 97.3% of the section (the rest is front matter
 * before the first anchor).
 */

import { isImageOnlyDoc } from './ocr';
import {
  chaptersFromHeadings,
  collectBlocks,
  dropJunk,
  FRONT_MATTER,
  isChapterHeading,
  partTitle,
  splitOversized,
  tocLooksBroken,
  type TextBlock,
} from './structure';

// Inline elements never introduce a chapter: an anchor on one points at a word
// inside running prose (a glossary or footnote reference), not a heading.
const INLINE_TAGS = new Set([
  'SPAN',
  'A',
  'EM',
  'STRONG',
  'I',
  'B',
  'SUP',
  'SUB',
  'CODE',
  'SMALL',
  'CITE',
  'ABBR',
]);

// Below this a slice is not a chapter in its own right — a part/volume header
// sitting just above the first real chapter, or a stray anchor. Merged forward.
const MIN_CHAPTER_CHARS = 1000;

export interface FeedChapter {
  idx: number;
  title: string;
  text: string;
  // A scanned book's chapter: the sections (pages) it spans. Its text is ''
  // until the chapter is opened and the pages are read (see ocr.ts).
  scannedSections?: number[];
}

interface TocEntryLike {
  label?: string;
  // A string for EPUB/MOBI. PDF outlines carry a numeric page `index` and
  // sometimes a numeric href; never assume it's a string.
  href?: string | number;
  index?: number;
  subitems?: TocEntryLike[];
}

// Where a chapter starts: a section, and an element within it — or null for
// the top of the section (a fragment-less TOC entry, or a PDF page).
interface Anchor {
  section: number;
  el: Element | null;
  label: string;
}

// With no TOC to go by, consecutive sections are grouped into parts of about
// this many characters. One chapter per section is one per PAGE for a PDF —
// a 300-page book listed as 300 "chapters".
const TARGET_PART_CHARS = 12000;

interface SectionLike {
  createDocument?: () => Promise<Document>;
  load?: () => unknown;
}

interface BookDocLike {
  sections?: SectionLike[];
  toc?: TocEntryLike[];
  resolveHref?: (href: string) => { index?: number } | null | undefined;
}

export const flattenToc = (items: TocEntryLike[]): TocEntryLike[] =>
  items.flatMap((item) => [item, ...(item.subitems ? flattenToc(item.subitems) : [])]);

const countLabels = (labels: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
};

/** The flattened TOC, a label that repeats ("Chapter 1" in every part)
 * prefixed by its parent entry's so the chapter list can tell them apart. */
const labelledToc = (items: TocEntryLike[]): TocEntryLike[] => {
  const withParents = (list: TocEntryLike[], parent: string): [TocEntryLike, string][] =>
    list.flatMap((item) => [
      [item, parent] as [TocEntryLike, string],
      ...withParents(item.subitems ?? [], item.label?.trim() ?? ''),
    ]);
  const entries = withParents(items, '');
  const counts = countLabels(entries.map(([item]) => item.label?.trim() ?? ''));
  return entries.map(([item, parent]) => {
    const label = item.label?.trim() ?? '';
    return parent && label && counts.get(label)! > 1
      ? { ...item, label: `${parent} · ${label}` }
      : item;
  });
};

/** A flat TOC (parts and chapters as siblings) still repeats labels. In
 * reading order, from the second run on, prefix each with the latest part —
 * an entry that is neither repeated nor itself a chapter heading. */
const disambiguateAnchors = (anchors: Anchor[]): Anchor[] => {
  const counts = countLabels(anchors.map((a) => a.label));
  const seen = new Set<string>();
  let part = '';
  return anchors.map((anchor) => {
    const { label } = anchor;
    const repeated = !!label && counts.get(label)! > 1;
    const firstRun = !seen.has(label);
    seen.add(label);
    if (!repeated) {
      if (label && !isChapterHeading(label)) part = label;
      return anchor;
    }
    return !firstRun && part ? { ...anchor, label: `${part} · ${label}` } : anchor;
  });
};

/**
 * Is this anchor a chapter boundary, or a reference inside running text?
 *
 * Chapter anchors are block-level and sit outside any text block (in Ponniyin
 * Selvan, `<p class="block_27">` children of `<body>` whose text IS the title).
 * Glossary anchors are inline elements nested inside a paragraph. Note the
 * `parentElement.closest` — using `el.closest('p')` matches a `<p>` chapter
 * heading against ITSELF and classifies every chapter as glossary.
 */
export const isChapterAnchor = (el: Element): boolean =>
  !INLINE_TAGS.has(el.tagName) && !el.parentElement?.closest('p, li, blockquote');

/** Text between two anchors. A Range, not sibling walking: anchors nest at
 * different depths, and a `nextElementSibling` walk that never meets its end
 * node runs to the end of the document (one slice came back at 3.2M chars). */
const sliceBetween = (doc: Document, start: Element, end: Element | undefined): string => {
  const range = doc.createRange();
  range.setStartBefore(start);
  if (end) {
    range.setEndBefore(end);
  } else if (doc.body.lastElementChild) {
    range.setEndAfter(doc.body.lastElementChild);
  } else {
    return '';
  }
  return range.toString().replace(/\s+/g, ' ').trim();
};

/**
 * Fold slices shorter than MIN_CHAPTER_CHARS into the following chapter,
 * keeping the LATER title — a "Part 1" header immediately above the first
 * chapter should yield that chapter's name, not the part's. A trailing short
 * slice merges backwards instead, keeping the earlier title.
 */
export const mergeShortChapters = (chapters: FeedChapter[]): FeedChapter[] => {
  const out: FeedChapter[] = [];
  let carry = '';
  for (const [i, chapter] of chapters.entries()) {
    const text = carry ? `${carry} ${chapter.text}`.trim() : chapter.text;
    const isLast = i === chapters.length - 1;
    if (text.length < MIN_CHAPTER_CHARS && !isLast) {
      carry = text;
      continue;
    }
    carry = '';
    if (text.length < MIN_CHAPTER_CHARS && out.length > 0) {
      const prev = out[out.length - 1]!;
      out[out.length - 1] = { ...prev, text: `${prev.text} ${text}`.trim() };
      continue;
    }
    out.push({ idx: out.length, title: chapter.title, text });
  }
  return out;
};

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A PDF page's text layer (foliate/pdf.js) is one <span> per line with no <br>
 * between lines — words within a line get explicit " " spans, line ends get
 * nothing — so textContent glued lines together ("They called menymph"). The
 * model's correctly spaced verbatim quotes then never matched the source and
 * nearly every card was dropped. Insert a space where two spans touch without
 * whitespace; a line ending in "-" stays joined ("high-" + "arched"). Only
 * `.textLayer` is touched, so EPUB/MOBI text is unaffected.
 */
const spaceTextLayerLines = (doc: Document): void => {
  for (const layer of Array.from(doc.querySelectorAll('.textLayer'))) {
    let prev: string | null = null;
    for (const span of Array.from(layer.children)) {
      const text = span.textContent ?? '';
      if (!text) continue;
      if (prev !== null && !/\s$/.test(prev) && !/^\s/.test(text) && !prev.endsWith('-')) {
        span.before(doc.createTextNode(' '));
      }
      prev = text;
    }
  }
};

/** Everything in the document before `end`. */
const sliceBefore = (doc: Document, end: Element): string => {
  const range = doc.createRange();
  range.setStart(doc.body, 0);
  range.setEndBefore(end);
  return normalize(range.toString());
};

/** Anchors in spine order, then document order within a section: parts and
 * their chapters interleave in the TOC, and a TOC can list them out of order. */
const compareAnchors = (a: Anchor, b: Anchor): number => {
  if (a.section !== b.section) return a.section - b.section;
  if (!a.el || !b.el) return a.el ? 1 : b.el ? -1 : 0;
  return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
};

// A book is read as scanned when at least this many pages are pictures of
// text and they outnumber the pages with real text.
const MIN_SCANNED_PAGES = 3;
// A scanned book with no outline is offered in runs of this many pages.
const SCANNED_PAGES_PER_PART = 10;

/**
 * Chapters of a book, for any format foliate opens.
 *
 * With a usable TOC, a chapter is the span from its TOC anchor to the NEXT
 * anchor in spine order — across section boundaries. The first cut of this
 * took only the section the anchor sat in, which dropped the rest of any
 * chapter split across several XHTML files, dropped every section the TOC
 * didn't list, and reduced a PDF chapter to the single page its outline entry
 * pointed at. Text before the first anchor is kept as front matter.
 *
 * With no TOC, or one that doesn't structure the book (one entry for the whole
 * of it), chapters are found from the headings in the text (structure.ts);
 * failing that, consecutive sections are grouped into parts. A scanned book is
 * split into page ranges whose text is read when opened (ocr.ts). Contents,
 * copyright and similar pages are dropped in every case.
 */
export async function extractChapters(bookDoc: unknown): Promise<FeedChapter[]> {
  const doc = bookDoc as BookDocLike;
  const sections = doc.sections ?? [];
  const tocFlat = doc.toc?.length ? labelledToc(doc.toc) : [];

  const documents = new Map<number, Document | null>();
  const getDoc = async (index: number): Promise<Document | null> => {
    if (!documents.has(index)) {
      let created: Document | null = null;
      try {
        created = (await sections[index]?.createDocument?.()) ?? null;
        if (created) spaceTextLayerLines(created);
      } catch (err) {
        // A corrupt entry costs one section, not the book.
        console.warn('[scrollfeed] section failed to load', index, err);
      }
      documents.set(index, created);
    }
    return documents.get(index) ?? null;
  };
  const sectionText = async (index: number): Promise<string> =>
    normalize((await getDoc(index))?.body?.textContent || '');

  const anchors: Anchor[] = [];
  for (const entry of tocFlat) {
    const href = typeof entry.href === 'string' ? entry.href : '';
    const hash = href.split('#')[1];
    // PDF outlines carry the page index directly; EPUB/MOBI resolve the href.
    let index = typeof entry.index === 'number' ? entry.index : -1;
    if (index < 0 && href) {
      // foliate's resolveHref throws on hrefs it can't parse (odd MOBI and
      // PDF outlines). Left unhandled that surfaced as "Could not read book."
      // for the whole title; one bad entry costs one entry.
      try {
        const resolved = doc.resolveHref?.(href);
        index = typeof resolved?.index === 'number' ? resolved.index : -1;
      } catch {
        continue;
      }
    }
    if (index < 0 || index >= sections.length) continue;
    const sectionDoc = await getDoc(index);
    if (!sectionDoc) continue;

    // A fragment names an element; anything else names the top of the section.
    let el: Element | null = null;
    if (hash) {
      el = sectionDoc.getElementById(hash);
      // Only fragment anchors can land mid-prose (a glossary or footnote
      // reference); a section start cannot.
      if (!el || !isChapterAnchor(el)) continue;
    }
    const label = entry.label?.trim() || '';
    // Two entries for the same spot (a part and its first chapter, say)
    // yield one chapter; the earlier label wins.
    if (!anchors.some((a) => a.section === index && a.el === el)) {
      anchors.push({ section: index, el, label });
    }
  }
  anchors.sort(compareAnchors);

  // Scanned pages have no text to slice; they are read when their chapter opens.
  let scannedPages = 0;
  let textPages = 0;
  let totalChars = 0;
  for (let i = 0; i < sections.length; i++) {
    const sectionDoc = await getDoc(i);
    const text = await sectionText(i);
    totalChars += text.length;
    // A section with no document but a loader is a bare page image (CBZ).
    const pageImage = sectionDoc ? isImageOnlyDoc(sectionDoc) : !!sections[i]?.load;
    if (pageImage) scannedPages++;
    else if (text) textPages++;
  }
  if (scannedPages >= MIN_SCANNED_PAGES && scannedPages >= textPages) {
    return scannedChapters(anchors, sections.length);
  }

  let chapters = anchors.length
    ? await tocChapters(disambiguateAnchors(anchors), sections.length, getDoc, sectionText)
    : [];
  if (!anchors.length || tocLooksBroken(mergeShortChapters(chapters), totalChars)) {
    const blocks: TextBlock[] = [];
    for (let i = 0; i < sections.length; i++) {
      const sectionDoc = await getDoc(i);
      if (sectionDoc) blocks.push(...collectBlocks(sectionDoc, i));
    }
    const found = chaptersFromHeadings(blocks);
    if (found && (!anchors.length || !tocLooksBroken(mergeShortChapters(found), totalChars))) {
      chapters = found;
    } else if (!anchors.length) {
      chapters = await groupSections(sections.length, sectionText);
    }
  }
  // Junk goes first: merged into the next chapter, a short contents page
  // could no longer be told apart from it.
  return splitOversized(mergeShortChapters(dropJunk(chapters)));
}

/** Chapters between TOC anchors, with the front matter before the first. */
async function tocChapters(
  anchors: Anchor[],
  sectionCount: number,
  getDoc: (index: number) => Promise<Document | null>,
  sectionText: (index: number) => Promise<string>,
): Promise<FeedChapter[]> {
  // Text between two anchors, spanning whole sections in between.
  const spanText = async (from: Anchor, to: Anchor | undefined): Promise<string> => {
    const startDoc = await getDoc(from.section);
    const startEl = from.el ?? startDoc?.body.firstElementChild ?? null;
    if (!startDoc || !startEl) return '';
    if (to && to.section === from.section) {
      return to.el ? sliceBetween(startDoc, startEl, to.el) : '';
    }
    const parts = [sliceBetween(startDoc, startEl, undefined)];
    const lastFull = to ? to.section - 1 : sectionCount - 1;
    for (let i = from.section + 1; i <= lastFull; i++) parts.push(await sectionText(i));
    if (to?.el) parts.push(sliceBefore((await getDoc(to.section))!, to.el));
    return normalize(parts.join(' '));
  };

  const chapters: FeedChapter[] = [];
  const first = anchors[0]!;
  const frontParts: string[] = [];
  for (let i = 0; i < first.section; i++) frontParts.push(await sectionText(i));
  if (first.el) frontParts.push(sliceBefore((await getDoc(first.section))!, first.el));
  const front = normalize(frontParts.join(' '));
  if (front) chapters.push({ idx: 0, title: FRONT_MATTER, text: front });

  for (const [i, anchor] of anchors.entries()) {
    const text = await spanText(anchor, anchors[i + 1]);
    if (!text) continue;
    chapters.push({
      idx: chapters.length,
      title: anchor.label || `Chapter ${chapters.length + 1}`,
      text,
    });
  }
  return chapters;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => from + i);

/** A scanned book's chapters as page ranges, named by its TOC or outline when
 * it has one, else by page numbers. */
function scannedChapters(anchors: Anchor[], sectionCount: number): FeedChapter[] {
  const distinct = anchors.filter((a, i) => i === 0 || a.section !== anchors[i - 1]!.section);
  // A TOC entry for nearly every page (a comic's list of image files) is no
  // chapter structure; page ranges read better.
  const starts = distinct.length > sectionCount / 2 ? [] : distinct;
  const chapters: FeedChapter[] = [];
  const add = (title: string, from: number, to: number) => {
    if (to > from) {
      chapters.push({ idx: chapters.length, title, text: '', scannedSections: range(from, to) });
    }
  };
  if (starts.length) {
    add(FRONT_MATTER, 0, starts[0]!.section);
    for (const [i, start] of starts.entries()) {
      add(
        start.label || `Chapter ${chapters.length + 1}`,
        start.section,
        starts[i + 1]?.section ?? sectionCount,
      );
    }
    return chapters;
  }
  for (let from = 0; from < sectionCount; from += SCANNED_PAGES_PER_PART) {
    const to = Math.min(from + SCANNED_PAGES_PER_PART, sectionCount);
    add(`Pages ${from + 1}–${to}`, from, to);
  }
  return chapters;
}

/** No usable structure: group consecutive sections into parts of about
 * TARGET_PART_CHARS, named by their opening words. Nothing is dropped; a
 * single short book is one part. */
async function groupSections(
  count: number,
  sectionText: (index: number) => Promise<string>,
): Promise<FeedChapter[]> {
  const parts: FeedChapter[] = [];
  let buffer: string[] = [];
  let size = 0;
  const flush = () => {
    const text = normalize(buffer.join(' '));
    if (text) parts.push({ idx: parts.length, title: partTitle(parts.length, text), text });
    buffer = [];
    size = 0;
  };
  for (let i = 0; i < count; i++) {
    const text = await sectionText(i);
    if (!text) continue;
    buffer.push(text);
    size += text.length;
    if (size >= TARGET_PART_CHARS) flush();
  }
  flush();
  return parts;
}
