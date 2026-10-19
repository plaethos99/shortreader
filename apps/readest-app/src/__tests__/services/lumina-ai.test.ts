import { beforeEach, describe, expect, test, vi } from 'vitest';

const { chatJson, chatText } = vi.hoisted(() => ({ chatJson: vi.fn(), chatText: vi.fn() }));

vi.mock('@/services/llm', () => ({
  chatJson,
  chatText,
}));

import { analyzeChapter, chatWithBook, summarizeBook } from '@/services/luminaAI';

describe('luminaAI', () => {
  beforeEach(() => {
    chatJson.mockReset();
    chatText.mockReset();
  });

  // JSON mode checks syntax only. The panel maps over these arrays, so a
  // missing one used to be a render crash rather than an empty section.
  test('analyzeChapter fills fields the model left out', async () => {
    chatJson.mockResolvedValueOnce({
      overview: 'o',
      keyThemes: 'not an array',
      visualTopics: [{ title: 't' }, null],
    });

    const analysis = await analyzeChapter('One', 'text', 'Book', 'A');

    expect(analysis).toEqual({
      overview: 'o',
      keyThemes: [],
      importantQuotes: [],
      concepts: [],
      detailedBreakdown: '',
      visualTopics: [{ title: 't', visualPrompt: '' }],
    });
  });

  test('summarizeBook falls back to "other" for an unknown genre', async () => {
    chatJson.mockResolvedValueOnce({ summary: 's', keyTakeaways: ['k'], genre: 'poetry' });

    expect(await summarizeBook('T', 'A', 'text')).toEqual({
      summary: 's',
      keyTakeaways: ['k'],
      genre: 'other',
    });
  });

  test('chatWithBook sends the book as system context and maps model turns', async () => {
    chatText.mockResolvedValueOnce('answer');

    const reply = await chatWithBook(
      'why?',
      [
        { role: 'user', parts: [{ text: 'q1' }] },
        { role: 'model', parts: [{ text: 'a1' }] },
      ],
      'Book',
      'CONTENT',
    );

    expect(reply).toBe('answer');
    const messages = chatText.mock.calls[0]![0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('CONTENT');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'why?' },
    ]);
  });
});
