'use client';

// PDF Reflow view — renders a fixed-layout book (PDF) as reflowable, fully
// font-customizable HTML text. The faithful FoliateViewer rasterizes each PDF
// page to a <canvas>, so its text can't be restyled (only zoom + page colors).
// This alternative extracts the PDF's text and lays it out as normal HTML that
// honors the reader's font settings — family, size, weight, line height, word/
// letter spacing, indent, justification, margins and theme colors — exactly
// like an EPUB. Toggled per book via viewSettings.pdfReflow.
import React, { useEffect, useRef, useState } from 'react';
import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { mountCustomFont } from '@/styles/fonts';
import { extractBookText, type ExtractedChapter } from '@/services/luminaBookText';
import { getBaseFontFamily, getThemeCode } from '@/utils/style';

interface PdfReflowViewProps {
  bookKey: string;
  bookDoc: BookDoc;
  contentInsets: { top: number; right: number; bottom: number; left: number };
}

// Split a chapter's raw extracted text into paragraphs. PDF extraction yields
// newline-separated lines; treat blank-line gaps as paragraph breaks and single
// newlines as soft wraps that we join, so the reflowed text reads naturally.
const toParagraphs = (text: string): string[] => {
  const normalized = text.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\s*\n+/);
  return blocks.map((b) => b.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
};

const PdfReflowView: React.FC<PdfReflowViewProps> = ({ bookKey, bookDoc, contentInsets }) => {
  const viewState = useReaderStore((s) => s.viewStates[bookKey]);
  const viewSettings = viewState?.viewSettings ?? null;
  // Subscribe to the font list so mounting re-runs as fonts finish loading.
  const fonts = useCustomFontStore((s) => s.fonts);
  const getLoadedFonts = useCustomFontStore((s) => s.getLoadedFonts);

  const [chapters, setChapters] = useState<ExtractedChapter[]>([]);
  const [fullText, setFullText] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    extractBookText(bookDoc)
      .then(({ fullText: ft, chapters: chs }) => {
        if (cancelled) return;
        setFullText(ft);
        setChapters(chs);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookDoc]);

  // The reflow view lives in the TOP document, whereas EPUB custom fonts are
  // injected into the reader iframe. The top-document mount FoliateViewer does
  // is gated behind settings.customFonts, so mount them here too — idempotent
  // (keyed by font id) — so the selected custom family actually resolves.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    for (const font of getLoadedFonts()) {
      try {
        mountCustomFont(document, font);
      } catch {
        /* font without a blob URL yet — a later fonts change will remount */
      }
    }
  }, [fonts, getLoadedFonts]);

  if (!viewSettings) return null;

  const theme = getThemeCode();
  const fontFamily = getBaseFontFamily(viewSettings);
  const fontSize = viewSettings.defaultFontSize || 16;

  const containerStyle: React.CSSProperties = {
    color: theme.fg,
    backgroundColor: theme.bg,
    paddingTop: contentInsets.top + 16,
    paddingBottom: contentInsets.bottom + 32,
    paddingLeft: contentInsets.left,
    paddingRight: contentInsets.right,
  };

  const proseStyle: React.CSSProperties = {
    maxWidth: '46rem',
    margin: '0 auto',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight: viewSettings.fontWeight || 400,
    lineHeight: viewSettings.lineHeight || 1.5,
    wordSpacing: `${viewSettings.wordSpacing || 0}px`,
    letterSpacing: `${viewSettings.letterSpacing || 0}px`,
    textAlign: viewSettings.fullJustification ? 'justify' : 'start',
    hyphens: viewSettings.hyphenation ? 'auto' : 'manual',
  };

  const paragraphStyle: React.CSSProperties = {
    textIndent: `${viewSettings.textIndent ?? 0}em`,
    margin: `0 0 ${viewSettings.paragraphMargin ?? 1}em 0`,
  };

  // Prefer per-chapter sections (gives headings + structure); fall back to the
  // flat fullText when the PDF exposes no usable TOC.
  const sections =
    chapters.length > 0
      ? chapters.map((c) => ({ id: c.idx, title: c.title, paragraphs: toParagraphs(c.text) }))
      : [{ id: 0, title: '', paragraphs: toParagraphs(fullText) }];

  return (
    <div
      ref={scrollRef}
      // z-[1]: above the foliate canvas (z-auto) but below the header/footer
      // chrome (z-10/z-20) so those stay visible and interactive.
      className='absolute inset-0 z-[1] overflow-y-auto'
      style={containerStyle}
      data-pdf-reflow
    >
      <div style={proseStyle}>
        {loading && <p style={{ opacity: 0.6 }}>Extracting text…</p>}
        {err && !loading && (
          <p style={{ color: '#dc2626' }}>Couldn&apos;t reflow this PDF: {err}</p>
        )}
        {!loading &&
          !err &&
          sections.map((s) => (
            <section key={s.id} style={{ marginBottom: '1.5em' }}>
              {s.title && (
                <h2
                  style={{
                    fontFamily,
                    fontSize: `${Math.round(fontSize * 1.35)}px`,
                    fontWeight: 600,
                    margin: '1.2em 0 0.6em',
                    lineHeight: 1.25,
                  }}
                >
                  {s.title}
                </h2>
              )}
              {s.paragraphs.map((p, i) => (
                <p key={i} style={paragraphStyle}>
                  {p}
                </p>
              ))}
              {s.paragraphs.length === 0 && !s.title && (
                <p style={{ opacity: 0.6 }}>No extractable text found in this document.</p>
              )}
            </section>
          ))}
      </div>
    </div>
  );
};

export default PdfReflowView;
