/**
 * Lumina AI — reading features ported from the Lumina app, reusing Lumina's
 * prompts. Text runs on the reader's own model and key (services/llm);
 * images (mind maps, visuals, comics) come from Google Flow or Grok Imagine
 * through the image bridge (services/imageBridge). Independent of readest's
 * own (Ollama/OpenRouter) AI assistant.
 */
import { chatJson, chatText } from './llm';
import { generateImage, type ImageAspect } from './imageBridge';
import { isImageGenConfigured, isTextAIConfigured } from './byok/aiConfig';

export const isLuminaAIConfigured = isTextAIConfigured;
export { isImageGenConfigured };

const ask = (prompt: string): Promise<string> => chatText([{ role: 'user', content: prompt }]);

// The panel renders LaTeX between $...$ (utils/mathText), so ask for exactly
// that. In JSON replies backslashes must be doubled, or "\frac" decodes as a
// form feed followed by "rac".
const MATH_IN_TEXT =
  'Write any equation or formula as LaTeX: inline between $...$, or on its own between $$...$$.';
const MATH_IN_JSON = `${MATH_IN_TEXT} Inside JSON strings every backslash must be doubled ("$v = \\\\frac{d}{t}$").`;

// JSON mode guarantees syntax, not shape (Gemini's responseSchema did both), so
// a missing or mistyped field becomes an empty value instead of a crash.
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const GENRES: BookSummary['genre'][] = ['fiction', 'non-fiction', 'academic', 'other'];

export interface BookSummary {
  summary: string;
  keyTakeaways: string[];
  genre: 'fiction' | 'non-fiction' | 'academic' | 'other';
}

export async function summarizeBook(
  title: string,
  author: string,
  fullText: string,
): Promise<BookSummary> {
  const textSample = fullText.slice(0, 100000);

  const prompt = `
    Summarize "${title}" by "${author}".
    Also detect the genre: "fiction", "non-fiction", or "academic".
    Return as a JSON object with "summary", "keyTakeaways" (array), and "genre".
    ${MATH_IN_JSON}
    ${textSample}
  `;

  try {
    const raw = await chatJson<Partial<BookSummary>>(prompt);
    return {
      summary: str(raw.summary),
      keyTakeaways: strings(raw.keyTakeaways),
      genre: GENRES.includes(raw.genre as BookSummary['genre'])
        ? (raw.genre as BookSummary['genre'])
        : 'other',
    };
  } catch (e) {
    throw new Error('Failed to parse: ' + (e instanceof Error ? e.message : String(e)));
  }
}

export interface ChapterAnalysis {
  overview: string;
  keyThemes: string[];
  importantQuotes: string[];
  concepts: string[];
  detailedBreakdown: string;
  visualTopics: { title: string; visualPrompt: string }[];
}

/**
 * Chapter-wise insights — overview, key quotes, themes, concepts, and visual
 * topics for a single chapter. This is the heart of Lumina's Summary tab.
 */
export async function analyzeChapter(
  chapterTitle: string,
  chapterText: string,
  bookTitle: string,
  author: string,
): Promise<ChapterAnalysis> {
  const textSample = chapterText.slice(0, 80000);
  const prompt = `Analyze chapter "${chapterTitle}" of "${bookTitle}"${author ? ` by ${author}` : ''}.
  Identify 3-5 key sections, scenes, or concepts that are visually significant.
  Return JSON: {overview: string, keyThemes: string[], importantQuotes: string[], concepts: string[], detailedBreakdown: string, visualTopics: [{title: string, visualPrompt: string}]}.
  ${MATH_IN_JSON}
  ${textSample}`;

  try {
    const raw = await chatJson<Partial<ChapterAnalysis>>(prompt);
    return {
      overview: str(raw.overview),
      keyThemes: strings(raw.keyThemes),
      importantQuotes: strings(raw.importantQuotes),
      concepts: strings(raw.concepts),
      detailedBreakdown: str(raw.detailedBreakdown),
      visualTopics: (Array.isArray(raw.visualTopics) ? raw.visualTopics : [])
        .map((t) => ({ title: str(t?.title), visualPrompt: str(t?.visualPrompt) }))
        .filter((t) => t.title || t.visualPrompt),
    };
  } catch (e) {
    throw new Error('Failed to parse chapter: ' + (e instanceof Error ? e.message : String(e)));
  }
}

export interface ChatTurn {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export async function chatWithBook(
  query: string,
  history: ChatTurn[],
  bookTitle: string,
  bookContent: string,
): Promise<string> {
  return chatText([
    {
      role: 'system',
      content: `You are a helpful AI reading assistant. Below is the primary content for your current discussion from the book "${bookTitle}". Please answer the user's questions based on this text. If the user asks about something not in this text, let them know you are focused on this specific section but can reference general knowledge about the book if needed. ${MATH_IN_TEXT}

Content:
${bookContent.slice(0, 100000)}`,
    },
    ...history.map((turn) => ({
      role: turn.role === 'model' ? ('assistant' as const) : ('user' as const),
      content: turn.parts.map((p) => p.text).join('\n'),
    })),
    { role: 'user', content: query },
  ]);
}

export async function explainText(
  text: string,
  bookTitle: string,
  chapterTitle?: string,
  chapterText?: string,
): Promise<string> {
  const passage = text.trim();
  const ctx =
    chapterText && chapterTitle
      ? `\n\nThis passage appears in the chapter "${chapterTitle}" of "${bookTitle}". Use the surrounding chapter text below as your authoritative context.\n\nCHAPTER TEXT:\n${chapterText.slice(0, 8000)}`
      : `\n\nThis passage is from "${bookTitle}".`;

  const prompt = `You are a reading companion. Explain the following passage clearly for a reader who paused on it.

What to cover:
- What the passage means in plain language
- Who or what is being referenced (characters, places, concepts, terms)
- Any context from the chapter needed to understand it

Style:
- Use markdown formatting (bold for key terms, short bulleted lists where helpful)
- Be concrete; cite the passage where it helps
- Keep the response under 180 words
- ${MATH_IN_TEXT}

PASSAGE:
${passage}
${ctx}`;

  return ask(prompt);
}

/** Mind map, drawn by the chosen image provider. Returns a data: URL. */
export async function generateMindMap(
  topic: string,
  description: string,
  bookTitle: string,
): Promise<string> {
  const prompt = `Create a highly professional, clean, and minimal mind map diagram for the topic: "${topic}".
  Context: This is from the book "${bookTitle}".
  Focus on: ${description}.
  Design: Use a clear central hub with branching nodes, logical connections, and readable text labels.
  Style: Modern infographic, high contrast, clean white background, elegant typography.
  Ensure all text in the diagram is Sharp and Legible.`;

  return generateImage(prompt, '16:9');
}

/** Generate an illustrative image (visuals / comic / feed card) as a data: URL. */
export const generateBookVisual = (prompt: string, aspect: ImageAspect = '16:9'): Promise<string> =>
  generateImage(prompt, aspect);

const DEFAULT_CONVERSE_PROMPTS = [
  'Who are the main characters and what drives them?',
  "What's the central theme of this book?",
  'Walk me through the most important moment.',
  'If I remember one idea from this book, what should it be?',
];

/** Four conversation-starter questions grounded in the book overview. */
export async function suggestConversePrompts(
  bookTitle: string,
  bookOverview: string,
): Promise<string[]> {
  const prompt = `For the book "${bookTitle}", give me 4 short, varied conversation-starter questions a curious reader might ask an AI about it. Mix factual, thematic, and reflective. One sentence each, no numbering, no quotes, plain text. Return ONE per line.

Book overview:
${bookOverview.slice(0, 2000)}`;
  try {
    const out = (await ask(prompt))
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 5 && l.length < 200)
      .slice(0, 4);
    return out.length > 0 ? out : DEFAULT_CONVERSE_PROMPTS;
  } catch {
    return DEFAULT_CONVERSE_PROMPTS;
  }
}

/** Literary translation of a passage into the target language. */
export async function translateText(text: string, targetLang: string): Promise<string> {
  if (text.trim().length === 0) return text;
  const prompt = `You are a literary translator. Translate the passage below into ${targetLang}.

Rules:
- Output ONLY the translation, no preamble, no notes, no transliteration.
- Preserve paragraph breaks.

PASSAGE:
${text}`;
  return ask(prompt);
}
