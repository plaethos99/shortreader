/**
 * Reading scanned books: pages that are pictures of text.
 *
 * An old book scanned to PDF has an empty text layer; a scanned EPUB, CBZ or
 * MOBI has a page image and no text. Either way the feed had nothing to retell.
 * Such pages are sent to the reader's model, which must read images (~1k tokens a
 * page) in any language and script, and the text it returns stands in for the
 * page's. It is done per chapter as the chapter opens — never the whole book up
 * front — and cached per page, so a page is read once.
 */
import { chatImage } from '../llm';
import type { FeedChapter } from './chapters';
import { loadOcrText, saveOcrText } from './store';

// Below this much text, a page with a picture on it is a picture of text.
const MIN_TEXT_CHARS = 40;

// Pages read at once; enough to hide the round trip, few enough not to flood
// a phone's connection or the API.
const CONCURRENCY = 4;

const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const OCR_PROMPT = `This is a page of a scanned book. Transcribe all of its text exactly, in the
original language and script, in reading order. Leave out running headers,
footers and page numbers. Do not translate, summarise or comment. If the page
has no text, reply with nothing.`;

export interface ScannableSection {
  createDocument?: () => Promise<Document>;
  load?: () => unknown;
  unload?: () => void;
  // foliate's PDF sections: the page rendered to an image.
  renderImage?: (width?: number) => Promise<Blob | null>;
}

interface ScannableBook {
  sections?: ScannableSection[];
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A page with (almost) no text but a picture, or a PDF page whose text layer
 * is empty. */
export const isImageOnlyDoc = (doc: Document): boolean => {
  if (normalize(doc.body?.textContent ?? '').length >= MIN_TEXT_CHARS) return false;
  return !!doc.querySelector('img, image, #canvas, canvas');
};

/** The page's text, with PDF text-layer lines kept apart. */
export const docText = (doc: Document): string => {
  const layer = doc.querySelector('.textLayer');
  if (layer) return normalize(Array.from(layer.children, (s) => s.textContent ?? '').join(' '));
  return normalize(doc.body?.textContent ?? '');
};

/** The page's pictures: a rendered PDF page, or the images of the section's
 * loaded HTML — which EPUB, MOBI, FB2 and CBZ all hand over with resource
 * URLs already resolved. */
export async function sectionImages(section: ScannableSection): Promise<Blob[]> {
  if (section.renderImage) {
    const image = await section.renderImage();
    return image ? [image] : [];
  }
  if (!section.load) return [];
  try {
    const url = await section.load();
    if (typeof url !== 'string') return [];
    const html = await (await fetch(url)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const srcs = Array.from(
      doc.querySelectorAll('img, image'),
      (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href'),
    ).filter((src): src is string => !!src);
    return await Promise.all(srcs.map(async (src) => (await fetch(src)).blob()));
  } finally {
    // Loaders count their users, so this releases only our hold on the page.
    section.unload?.();
  }
}

/** A format the API reads: JPEG, PNG, GIF or WebP. Others (BMP, TIFF, JXL…)
 * are re-encoded as JPEG where the platform can decode them. */
async function toSupportedImage(image: Blob): Promise<Blob | null> {
  if (SUPPORTED_TYPES.includes(image.type)) return image;
  try {
    const bitmap = await createImageBitmap(image);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch {
    return null;
  }
}

async function toDataUrl(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${image.type};base64,${btoa(binary)}`;
}

/** One page's text: its own text, or what OCR reads off its pictures. */
async function pageText(bookHash: string, index: number, section: ScannableSection) {
  const doc = await section.createDocument?.();
  if (doc && !isImageOnlyDoc(doc)) return docText(doc);

  const cached = await loadOcrText(bookHash, index);
  if (cached !== null) return cached;

  const texts: string[] = [];
  for (const image of await sectionImages(section)) {
    const supported = await toSupportedImage(image);
    if (supported) texts.push(await chatImage(OCR_PROMPT, await toDataUrl(supported)));
  }
  const text = normalize(texts.join(' '));
  await saveOcrText(bookHash, index, text);
  return text;
}

/** Fill a scanned chapter's text by reading its pages. `onProgress` reports
 * pages done out of pages in the chapter. */
export async function fillScannedChapter(
  bookDoc: unknown,
  bookHash: string,
  chapter: FeedChapter,
  onProgress?: (done: number, total: number) => void,
): Promise<FeedChapter> {
  const sections = (bookDoc as ScannableBook).sections ?? [];
  const pages = chapter.scannedSections ?? [];
  const texts: string[] = new Array(pages.length).fill('');
  let next = 0;
  let done = 0;
  onProgress?.(0, pages.length);
  const worker = async () => {
    while (next < pages.length) {
      const slot = next++;
      const section = sections[pages[slot]!];
      if (section) texts[slot] = await pageText(bookHash, pages[slot]!, section);
      onProgress?.(++done, pages.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
  return { ...chapter, text: normalize(texts.join(' ')) };
}
