import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it, vi } from 'vitest';

import { DocumentLoader } from '@/libs/document';
import { extractChapters } from '@/services/scrollfeed/chapters';

// Real files through the app's own loader, so the extractor is measured
// against what foliate actually produces — not hand-built fixtures. The
// hand-built ones caught the per-section bug; these guard against the next
// shape of book nobody thought of.

if (typeof globalThis['CSS'] === 'undefined') {
  (globalThis as Record<string, unknown>)['CSS'] = {
    escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
  };
}
if (!customElements.get('foliate-paginator')) {
  customElements.define(
    'foliate-paginator',
    class extends HTMLElement {
      override setAttribute() {}
      override addEventListener() {}
      open() {}
    },
  );
}
vi.mock('foliate-js/paginator.js', () => ({}));

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

const openBook = async (path: string, name: string, type: string) => {
  const bytes = new Uint8Array(readFileSync(path));
  const { book } = await new DocumentLoader(new File([bytes], name, { type })).open();
  if (!book) throw new Error(`loader returned no book for ${name}`);
  return book;
};

// Every character the book has, by the same measure the extractor uses.
const totalSectionChars = async (book: {
  sections: Array<{ createDocument?: () => Promise<Document> }>;
}) => {
  let total = 0;
  for (const section of book.sections) {
    const doc = await section.createDocument?.();
    total += normalize(doc?.body?.textContent || '').length;
  }
  return total;
};

const fixture = (name: string) => resolve(__dirname, `../fixtures/data/${name}`);

describe('extractChapters on real books', () => {
  it('covers Alice in Wonderland end to end with its real chapter titles', async () => {
    const book = await openBook(fixture('sample-alice.epub'), 'alice.epub', 'application/epub+zip');
    const chapters = await extractChapters(book);
    const covered = chapters.reduce((n, c) => n + c.text.length, 0);
    const total = await totalSectionChars(book);

    expect(chapters.length).toBeGreaterThan(5);
    expect(chapters.some((c) => /rabbit|hole/i.test(c.title))).toBe(true);
    // Nothing lost: the chapters carry at least 95% of the book's text.
    expect(covered / total).toBeGreaterThan(0.95);
  }, 30000);

  it('covers a large multi-section EPUB without dropping sections', async () => {
    const book = await openBook(
      fixture('sample-table-layout.epub'),
      'table.epub',
      'application/epub+zip',
    );
    const chapters = await extractChapters(book);
    const covered = chapters.reduce((n, c) => n + c.text.length, 0);
    const total = await totalSectionChars(book);

    expect(chapters.length).toBeGreaterThan(0);
    // Its last TOC entry, 目录 ("Contents"), covers four sections that are
    // nothing but contents lists (~18% of this small sample). Those are
    // dropped on purpose; everything else is kept.
    expect(covered / total).toBeGreaterThan(0.8);
    expect(chapters.some((c) => c.text.includes('CONTENTS'))).toBe(false);
  }, 60000);

  // Point SCROLLFEED_PDF at any real PDF to run this locally; it is the shape
  // (one section per page, numeric outline indices) that the first extractor
  // reduced to one page per chapter.
  const pdfPath = process.env['SCROLLFEED_PDF'];
  it.skipIf(!pdfPath || !existsSync(pdfPath))(
    'covers a real PDF and does not list one chapter per page',
    async () => {
      // The loader imports foliate's pdf.js lazily, and that module points
      // pdf.js at the web path /vendor/pdfjs/... as it loads. Load it first so
      // the override below lands after it; under Node the fake-worker
      // bootstrap must import the worker file itself.
      await import('@pdfjs/pdf.min.mjs');
      const pdfjs = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
        GlobalWorkerOptions: { workerSrc: string };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        resolve(__dirname, '../../../public/vendor/pdfjs/pdf.worker.min.mjs'),
      ).href;
      const book = await openBook(pdfPath!, 'book.pdf', 'application/pdf');
      const chapters = await extractChapters(book);
      const covered = chapters.reduce((n, c) => n + c.text.length, 0);
      const total = await totalSectionChars(book);
      // stdout directly: the vitest setup swallows console output.
      process.stdout.write(
        `[real-books] pdf ${JSON.stringify({
          pages: book.sections.length,
          outlineEntries: book.toc?.length ?? 0,
          chapters: chapters.length,
          coverage: `${((100 * covered) / total).toFixed(1)}%`,
          titles: chapters.slice(0, 6).map((c) => `${c.title} (${c.text.length})`),
        })}\n`,
      );

      expect(chapters.length).toBeGreaterThan(0);
      expect(chapters.length).toBeLessThan(book.sections.length);
      expect(covered / total).toBeGreaterThan(0.95);
    },
    120000,
  );
});
