/**
 * Extract the chapter list + full text from a readest BookDoc for the Lumina
 * AI panel. Chapters come from the book's Table of Contents (bookDoc.toc).
 * Each chapter's text is resolved to its spine section via, in order:
 *   1. foliate's `bookDoc.resolveHref(href) -> { index }` (EPUB/MOBI),
 *   2. the TOC item's numeric `index` (PDF page index),
 *   3. matching the section `id`/`href`.
 * Falls back to spine sections only when the book has no TOC.
 */

interface SectionLike {
  id?: string | number;
  href?: string;
  loadText?: () => Promise<string | null>;
  createDocument?: () => Promise<Document>;
}
interface TOCItemLike {
  label?: string;
  href?: string;
  index?: number;
  subitems?: TOCItemLike[];
}
interface BookDocLike {
  sections?: SectionLike[];
  toc?: TOCItemLike[];
  resolveHref?: (href: string) => { index?: number } | undefined | null;
}

export interface ExtractedChapter {
  idx: number;
  title: string;
  text: string;
}
export interface ExtractedBook {
  fullText: string;
  chapters: ExtractedChapter[];
}

// Crash-safe: PDF section ids/hrefs can be numbers, not strings.
const normHref = (href: unknown): string =>
  (typeof href === 'string' ? href : '')
    .split('#')[0]!
    .replace(/^\.?\//, '')
    .trim();
const baseName = (path: string): string => path.split('/').pop() || path;

const flattenToc = (
  items: TOCItemLike[],
  out: { label: string; href?: string; index?: number }[] = [],
) => {
  for (const it of items) {
    const label = (it.label || '').trim();
    if (label) out.push({ label, href: it.href, index: it.index });
    if (it.subitems?.length) flattenToc(it.subitems, out);
  }
  return out;
};

// createDocument() gives clean plain text via textContent; loadText() returns
// raw XHTML source, so it's stripped of tags as a fallback.
const readSection = async (sec: SectionLike): Promise<string> => {
  try {
    if (sec.createDocument) {
      const d = await sec.createDocument();
      const t = (d.body?.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    if (sec.loadText) {
      const raw = await sec.loadText();
      if (raw)
        return raw
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
    }
  } catch {
    /* section failed to render */
  }
  return '';
};

export async function extractBookText(bookDoc: unknown, maxChars = 500000): Promise<ExtractedBook> {
  const doc = bookDoc as BookDocLike;
  const sections = doc?.sections ?? [];

  // Load every spine section's text once, index-aligned with `sections`.
  const sectionTexts: string[] = [];
  let fullText = '';
  for (const s of sections) {
    const text = await readSection(s);
    sectionTexts.push(text);
    if (text && fullText.length < maxChars) fullText += text + '\n\n';
  }

  // id/href -> section index fallback map.
  const idToIndex = new Map<string, number>();
  sections.forEach((s, i) => {
    const id = normHref(s.id);
    if (id) idToIndex.set(id, i);
    const h = normHref(s.href);
    if (h) idToIndex.set(h, i);
  });

  const resolveIndex = (href: string | undefined, tocIndex: number | undefined): number => {
    if (typeof href === 'string' && href) {
      if (typeof doc.resolveHref === 'function') {
        try {
          const r = doc.resolveHref(href);
          if (r && typeof r.index === 'number' && r.index >= 0) return r.index;
        } catch {
          /* fall through */
        }
      }
      const p = normHref(href);
      if (idToIndex.has(p)) return idToIndex.get(p)!;
      const b = baseName(p);
      for (const [k, v] of idToIndex) if (baseName(k) === b) return v;
    }
    // PDF: TOC entries carry a page index directly.
    if (typeof tocIndex === 'number' && tocIndex >= 0 && tocIndex < sections.length)
      return tocIndex;
    return -1;
  };

  const tocFlat = doc.toc?.length ? flattenToc(doc.toc) : [];

  let chapters: ExtractedChapter[];
  if (tocFlat.length > 0) {
    chapters = tocFlat.map((entry, i) => {
      const secIdx = resolveIndex(entry.href, entry.index);
      const text = secIdx >= 0 ? (sectionTexts[secIdx] ?? '') : '';
      return { idx: i, title: entry.label || `Chapter ${i + 1}`, text };
    });
  } else {
    chapters = [];
    sectionTexts.forEach((text, i) => {
      if (text) chapters.push({ idx: chapters.length, title: `Section ${i + 1}`, text });
    });
  }

  return { fullText: fullText.trim(), chapters };
}
