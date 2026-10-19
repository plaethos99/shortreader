import { beforeEach, describe, expect, test, vi } from 'vitest';

const { chatImage, loadOcrText, saveOcrText } = vi.hoisted(() => ({
  chatImage: vi.fn(),
  loadOcrText: vi.fn(),
  saveOcrText: vi.fn(),
}));

vi.mock('@/services/llm', () => ({ chatImage }));
vi.mock('@/services/scrollfeed/store', () => ({ loadOcrText, saveOcrText }));

import { fillScannedChapter, isImageOnlyDoc, sectionImages } from '@/services/scrollfeed/ocr';

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
// A 1x1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const htmlUrl = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

describe('isImageOnlyDoc', () => {
  test('a page that is only a picture is scanned', () => {
    expect(isImageOnlyDoc(parse(`<img src="p1.jpg">`))).toBe(true);
    expect(isImageOnlyDoc(parse(`<svg><image href="p1.jpg"/></svg>`))).toBe(true);
  });

  test('a page with real text is not', () => {
    expect(
      isImageOnlyDoc(parse(`<img src="fig.jpg"><p>${'Words of the chapter. '.repeat(5)}</p>`)),
    ).toBe(false);
  });

  // foliate renders every PDF page with a canvas and a text layer; a scanned
  // page's text layer is empty.
  test('a PDF page with an empty text layer is scanned, one with text is not', () => {
    expect(isImageOnlyDoc(parse('<div id="canvas"></div><div class="textLayer"></div>'))).toBe(
      true,
    );
    expect(
      isImageOnlyDoc(
        parse(
          `<div id="canvas"></div><div class="textLayer"><span>${'Text. '.repeat(20)}</span></div>`,
        ),
      ),
    ).toBe(false);
  });

  test('an empty page with no picture is not scanned', () => {
    expect(isImageOnlyDoc(parse('<p> </p>'))).toBe(false);
  });
});

describe('sectionImages', () => {
  test('a PDF page is rendered through its renderImage hook', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const images = await sectionImages({ renderImage: async () => blob });

    expect(images).toEqual([blob]);
  });

  // EPUB, MOBI, FB2 and CBZ all load a section as HTML whose images are
  // already resolved to fetchable URLs.
  test('other formats: the images of the loaded section, then unload', async () => {
    const unload = vi.fn();
    const images = await sectionImages({
      load: async () => htmlUrl(`<html><body><img src="${PNG}"></body></html>`),
      unload,
    });

    expect(images).toHaveLength(1);
    expect(images[0]!.type).toBe('image/png');
    expect(unload).toHaveBeenCalledTimes(1);
  });

  test('unloads even when reading the section fails', async () => {
    const unload = vi.fn();
    await expect(
      sectionImages({
        load: async () => {
          throw new Error('boom');
        },
        unload,
      }),
    ).rejects.toThrow('boom');
    expect(unload).toHaveBeenCalledTimes(1);
  });
});

describe('fillScannedChapter', () => {
  beforeEach(() => {
    chatImage.mockReset();
    loadOcrText.mockReset().mockResolvedValue(null);
    saveOcrText.mockReset().mockResolvedValue(undefined);
  });

  const scannedPage = () => ({
    createDocument: async () => parse(`<img src="${PNG}">`),
    load: async () => htmlUrl(`<img src="${PNG}">`),
  });
  const textPage = (text: string) => ({ createDocument: async () => parse(`<p>${text}</p>`) });

  test("OCRs the chapter's scanned pages in order and keeps text pages as they are", async () => {
    chatImage.mockImplementation(async () => `page ${chatImage.mock.calls.length}`);
    const book = {
      sections: [
        scannedPage(),
        textPage('A real text page that needs no OCR at all, plainly.'),
        scannedPage(),
      ],
    };
    const progress = vi.fn();

    const chapter = await fillScannedChapter(
      book,
      'hash',
      { idx: 0, title: 'Pages 1–3', text: '', scannedSections: [0, 1, 2] },
      progress,
    );

    expect(chatImage).toHaveBeenCalledTimes(2);
    expect(chatImage.mock.calls[0]![1]).toMatch(/^data:image\/png;base64,/);
    expect(chapter.text).toMatch(
      /^page \d A real text page that needs no OCR at all, plainly\. page \d$/,
    );
    expect(saveOcrText).toHaveBeenCalledWith('hash', 0, expect.any(String));
    // Reported from the start, so the reader sees pages being read at once.
    expect(progress).toHaveBeenNthCalledWith(1, 0, 3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  test('a page read before comes from the cache, not a new call', async () => {
    loadOcrText.mockResolvedValue('cached words');
    const book = { sections: [scannedPage()] };

    const chapter = await fillScannedChapter(book, 'hash', {
      idx: 0,
      title: 'Pages 1–1',
      text: '',
      scannedSections: [0],
    });

    expect(chatImage).not.toHaveBeenCalled();
    expect(chapter.text).toBe('cached words');
  });

  test('a failed OCR call surfaces as an error rather than an empty chapter', async () => {
    chatImage.mockRejectedValue(new Error('DeepSeek 402: Insufficient Balance'));
    const book = { sections: [scannedPage()] };

    await expect(
      fillScannedChapter(book, 'hash', { idx: 0, title: 'P', text: '', scannedSections: [0] }),
    ).rejects.toThrow('402');
  });
});
