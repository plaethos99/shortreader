'use client';

// AI Insights — a faithful port of Lumina's editorial Insights view into
// readest. Two-column layout: a "Contents" chapter sidebar (Book overview +
// chapter list) on the left, and the selected chapter's insights (Overview,
// Key Quotes, Themes, Concepts) on the right. Self-contained: subscribes to
// the 'show-ai-panel' event and operates on the real book text + chapters
// extracted from the book's BookDoc — handed over by the feed, or loaded here
// when opened from a library card.
import { useEffect, useRef, useState } from 'react';
import {
  HiOutlineSparkles,
  HiOutlineBars3,
  HiChevronLeft,
  HiXMark,
  HiArrowsPointingOut,
  HiArrowsPointingIn,
  HiOutlineKey,
} from 'react-icons/hi2';
import {
  LiaCommentDotsSolid,
  LiaBroadcastTowerSolid,
  LiaMicrophoneSolid,
  LiaProjectDiagramSolid,
  LiaEyeSolid,
  LiaImageSolid,
  LiaDatabaseSolid,
} from 'react-icons/lia';
import Dialog from '@/components/Dialog';
import AiInsightsMark from '@/components/AiInsightsMark';
import { showAIKeys } from '@/components/AIKeysDialog';
import { useAIConfigStore } from '@/services/byok/aiConfig';
import { IMAGE_PROVIDER_LABELS } from '@/services/imageBridge';
import { useEnv } from '@/context/EnvContext';
import { loadBookDoc } from '@/services/aiBookDoc';
import { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { extractBookText, type ExtractedChapter } from '@/services/luminaBookText';
import {
  isLuminaAIConfigured,
  isImageGenConfigured,
  summarizeBook,
  analyzeChapter,
  chatWithBook,
  generateMindMap,
  generateBookVisual,
  suggestConversePrompts,
  type BookSummary,
  type ChapterAnalysis,
  type ChatTurn,
} from '@/services/luminaAI';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import { EdgeSpeaker } from '@/services/tts/aiSpeaker';
import MathText from '@/components/MathText';
import { mathToSpeech } from '@/utils/mathText';
import AiImageFrame from './AiImageFrame';

type EdgeVoice = { id: string; name: string; lang: string };

type Tab = 'summary' | 'chat' | 'converse' | 'audio' | 'mindmap' | 'visuals' | 'comic' | 'stored';
type ImageTab = 'mindmap' | 'visuals' | 'comic';
const CHAPTER_TABS: Tab[] = ['summary', 'chat', 'converse', 'mindmap', 'visuals', 'comic'];
const IMAGE_TABS: ImageTab[] = ['mindmap', 'visuals', 'comic'];
const isImageTab = (t: Tab): t is ImageTab => IMAGE_TABS.includes(t as ImageTab);

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
interface Artifact {
  id: string;
  kind: string;
  imageUrl?: string;
  text?: string;
}

/** A tappable chapter moment that drives mind map / visual / comic generation. */
interface Titbit {
  id: string;
  kind: 'scene' | 'theme' | 'concept' | 'quote';
  title: string;
  /** Longer text for mind-map focus / caption. */
  detail: string;
  /** Best prompt fragment for image models. */
  visualPrompt: string;
}

const TITBIT_KIND_LABEL: Record<Titbit['kind'], string> = {
  scene: 'Scene',
  theme: 'Theme',
  concept: 'Concept',
  quote: 'Quote',
};

const IMAGE_KIND_LABEL: Record<ImageTab, string> = {
  mindmap: 'mind map',
  visuals: 'visual',
  comic: 'comic panel',
};

/** Build clickable titbits from a chapter analysis (scenes first, then themes/concepts/quotes). */
const buildTitbits = (a: ChapterAnalysis): Titbit[] => {
  const out: Titbit[] = [];
  const seen = new Set<string>();
  const push = (t: Titbit) => {
    const key = t.title.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  (a.visualTopics || []).forEach((vt, i) => {
    const title = (vt.title || '').trim() || `Moment ${i + 1}`;
    const prompt = (vt.visualPrompt || title).trim();
    push({
      id: `scene-${i}`,
      kind: 'scene',
      title,
      detail: prompt,
      visualPrompt: prompt,
    });
  });

  (a.keyThemes || []).forEach((t, i) => {
    const raw = (t || '').trim();
    if (!raw) return;
    const ci = raw.indexOf(':');
    const title = ci > 0 ? raw.slice(0, ci).trim() : raw.slice(0, 48);
    const desc = ci > 0 ? raw.slice(ci + 1).trim() : raw;
    push({
      id: `theme-${i}`,
      kind: 'theme',
      title: title || `Theme ${i + 1}`,
      detail: desc,
      visualPrompt: `Thematic illustration of: ${raw}`,
    });
  });

  (a.concepts || []).forEach((c, i) => {
    const raw = (c || '').trim();
    if (!raw) return;
    push({
      id: `concept-${i}`,
      kind: 'concept',
      title: raw.length > 56 ? `${raw.slice(0, 53)}…` : raw,
      detail: raw,
      visualPrompt: `Concept visualization: ${raw}`,
    });
  });

  (a.importantQuotes || []).slice(0, 4).forEach((q, i) => {
    const raw = (q || '').trim();
    if (!raw) return;
    const short = raw.length > 64 ? `${raw.slice(0, 61)}…` : raw;
    push({
      id: `quote-${i}`,
      kind: 'quote',
      title: short,
      detail: raw,
      visualPrompt: `Literary scene illustrating the quote: "${raw}"`,
    });
  });

  return out.slice(0, 12);
};

const SERIF = "'Lora', 'Iowan Old Style', Georgia, serif";

// Persist generated artifacts per book so the "Stored" tab survives closing and
// reopening the panel (previously it was in-memory only and reset every open).
const ARTIFACTS_KEY = (hash: string) => `readster-ai-artifacts:${hash}`;

const loadArtifacts = (hash: string): Artifact[] => {
  try {
    const raw = localStorage.getItem(ARTIFACTS_KEY(hash));
    return raw ? (JSON.parse(raw) as Artifact[]) : [];
  } catch {
    return [];
  }
};

// Newest-first. Base64 image artifacts are large, so on a localStorage quota
// overflow drop the oldest entries until it fits — text artifacts always survive.
const saveArtifacts = (hash: string, list: Artifact[]) => {
  let items = list.slice(0, 50);
  for (;;) {
    try {
      localStorage.setItem(ARTIFACTS_KEY(hash), JSON.stringify(items));
      return;
    } catch {
      if (!items.length) {
        try {
          localStorage.removeItem(ARTIFACTS_KEY(hash));
        } catch {
          /* noop */
        }
        return;
      }
      items = items.slice(0, -1);
    }
  }
};

const TABS: {
  id: Tab;
  name: string;
  Icon: React.ElementType;
  text: string;
  active: string;
  accent: string;
}[] = [
  {
    id: 'summary',
    name: 'Summary',
    Icon: HiOutlineSparkles,
    text: 'text-amber-700 dark:text-amber-500',
    active: 'border-amber-600 dark:border-amber-500',
    accent: 'text-amber-700/80 dark:text-amber-500/80',
  },
  {
    id: 'chat',
    name: 'Chat',
    Icon: LiaCommentDotsSolid,
    text: 'text-rose-700 dark:text-rose-400',
    active: 'border-rose-600 dark:border-rose-500',
    accent: 'text-rose-700/80 dark:text-rose-400/80',
  },
  {
    id: 'converse',
    name: 'Converse',
    Icon: LiaBroadcastTowerSolid,
    text: 'text-teal-700 dark:text-teal-400',
    active: 'border-teal-600 dark:border-teal-500',
    accent: 'text-teal-700/80 dark:text-teal-400/80',
  },
  {
    id: 'audio',
    name: 'Audio',
    Icon: LiaMicrophoneSolid,
    text: 'text-orange-700 dark:text-orange-500',
    active: 'border-orange-600 dark:border-orange-500',
    accent: 'text-orange-700/80 dark:text-orange-500/80',
  },
  {
    id: 'mindmap',
    name: 'Mind Map',
    Icon: LiaProjectDiagramSolid,
    text: 'text-emerald-700 dark:text-emerald-400',
    active: 'border-emerald-600 dark:border-emerald-500',
    accent: 'text-emerald-700/80 dark:text-emerald-400/80',
  },
  {
    id: 'visuals',
    name: 'Visuals',
    Icon: LiaEyeSolid,
    text: 'text-violet-700 dark:text-violet-400',
    active: 'border-violet-600 dark:border-violet-500',
    accent: 'text-violet-700/80 dark:text-violet-400/80',
  },
  {
    id: 'comic',
    name: 'Comic',
    Icon: LiaImageSolid,
    text: 'text-red-700 dark:text-red-400',
    active: 'border-red-600 dark:border-red-500',
    accent: 'text-red-700/80 dark:text-red-400/80',
  },
  {
    id: 'stored',
    name: 'Stored',
    Icon: LiaDatabaseSolid,
    text: 'text-stone-600 dark:text-stone-300',
    active: 'border-stone-500 dark:border-stone-400',
    accent: 'text-stone-600/80 dark:text-stone-300/80',
  },
];

const AiPanel: React.FC = () => {
  const { appService } = useEnv();
  const appServiceRef = useRef(appService);
  appServiceRef.current = appService;
  // Re-render when the reader saves keys or switches picture provider.
  const imageProvider = useAIConfigStore((s) => s.config.imageProvider);
  useAIConfigStore((s) => s.config);
  const [book, setBook] = useState<Book | null>(null);
  const [bookText, setBookText] = useState('');
  const [chapters, setChapters] = useState<ExtractedChapter[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');
  const [err, setErr] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  // -1 = Book overview; >=0 = chapter index.
  const [selected, setSelected] = useState(-1);
  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [analyses, setAnalyses] = useState<Record<number, ChapterAnalysis>>({});
  const [busy, setBusy] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const [prompts, setPrompts] = useState<string[]>([]);
  const [converseBusy, setConverseBusy] = useState(false);

  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const speakerRef = useRef<EdgeSpeaker | null>(null);

  // Contents sidebar: open by default on desktop, collapsed on mobile.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640,
  );
  // Maximize the panel to near-fullscreen (desktop); mobile is already full.
  const [maximized, setMaximized] = useState(false);

  const [mindmapUrl, setMindmapUrl] = useState('');
  const [visualUrl, setVisualUrl] = useState('');
  const [comicUrl, setComicUrl] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  /** Which titbit is generating / last drove the preview image. */
  const [activeTitbitId, setActiveTitbitId] = useState('');

  const bookRef = useRef<Book | null>(null);
  bookRef.current = book;

  useEffect(() => {
    // Edge TTS voices (works on web via the /api/tts/edge proxy and on
    // Tauri/Android over WSS). English/user-locale voices sort first.
    const sorted = [...EdgeSpeechTTS.voices].sort((a, b) => {
      const ae = a.lang.startsWith('en') ? 0 : 1;
      const be = b.lang.startsWith('en') ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
    });
    setVoices(sorted);
  }, []);

  useEffect(() => {
    const onShow = async (event: CustomEvent) => {
      const detail = event.detail as
        | {
            book?: Book;
            bookDoc?: unknown;
            /** The feed's chapters, so a chapter picked there is the one shown here. */
            chapters?: ExtractedChapter[];
            chapterIdx?: number;
            tab?: Tab;
          }
        | undefined;
      const b = detail?.book;
      if (!b) return;
      setBook(b);
      setTab(detail.tab ?? 'summary');
      setErr('');
      setSelected(detail.chapterIdx ?? -1);
      setSummary(null);
      setAnalyses({});
      setMessages([]);
      setPrompts([]);
      setChapters(detail.chapters ?? []);
      setMindmapUrl('');
      setVisualUrl('');
      setComicUrl('');
      setActiveTitbitId('');
      // Restore previously generated artifacts for this book (persisted).
      setArtifacts(loadArtifacts(b.hash));

      const meta =
        `${b.title} by ${b.author || 'Unknown'}. ${b.metadata?.description || ''}`.trim();
      setBookText(meta);
      const service = appServiceRef.current;
      if (!detail.bookDoc && !service) return;
      setExtracting(true);
      try {
        // A library card hands over only the Book; without its document the
        // panel had no chapters to list.
        const bookDoc = detail.bookDoc ?? (await loadBookDoc(service!, b));
        const { fullText, chapters: chs } = await extractBookText(bookDoc);
        if (bookRef.current?.hash === b.hash) {
          if (fullText) setBookText(fullText);
          if (!detail.chapters) setChapters(chs);
        }
      } catch {
        /* keep meta */
      } finally {
        setExtracting(false);
      }
    };
    eventDispatcher.on('show-ai-panel', onShow);
    return () => {
      eventDispatcher.off('show-ai-panel', onShow);
      speakerRef.current?.stop();
    };
  }, []);

  if (!book) return null;
  const configured = isLuminaAIConfigured();
  const imageConfigured = isImageGenConfigured();
  const showSidebar = CHAPTER_TABS.includes(tab);
  const currentBook = book;

  const close = () => {
    speakerRef.current?.stop();
    setSpeaking(false);
    setBook(null);
  };

  const addArtifact = (a: Artifact) =>
    setArtifacts((prev) => {
      const next = [a, ...prev];
      const hash = bookRef.current?.hash;
      if (hash) saveArtifacts(hash, next);
      return next;
    });

  // Read text aloud via Edge TTS (works on web + Tauri/Android). Toggling while
  // speaking stops playback.
  const speak = async (text: string) => {
    const speaker = speakerRef.current ?? (speakerRef.current = new EdgeSpeaker());
    if (speaking) {
      speaker.stop();
      setSpeaking(false);
      return;
    }
    if (!text.trim()) return;
    setErr('');
    setSpeaking(true);
    try {
      await speaker.play(mathToSpeech(text), voiceURI);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSpeaking(false);
    }
  };

  const genBookSummary = async () => {
    if (summary || busy) return;
    setBusy(true);
    setErr('');
    try {
      const s = await summarizeBook(currentBook.title, currentBook.author || '', bookText);
      setSummary(s);
      addArtifact({ id: `sum-${Date.now()}`, kind: 'Book summary', text: s.summary });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const analyze = async (idx: number) => {
    if (analyses[idx] || busy) return;
    const ch = chapters[idx];
    if (!ch) return;
    setBusy(true);
    setErr('');
    try {
      const a = await analyzeChapter(
        ch.title,
        ch.text,
        currentBook.title,
        currentBook.author || '',
      );
      setAnalyses((prev) => ({ ...prev, [idx]: a }));
      addArtifact({
        id: `ch-${idx}-${Date.now()}`,
        kind: `Chapter: ${ch.title}`,
        text: a.overview,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || chatBusy) return;
    setTab('chat');
    const next = [...messages, { role: 'user' as const, text: q }];
    setMessages(next);
    setChatInput('');
    setChatBusy(true);
    try {
      const history: ChatTurn[] = messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));
      // A scanned chapter the feed hasn't read yet has no text: use the book's.
      const context = (selected >= 0 && chapters[selected]?.text) || bookText;
      const reply = await chatWithBook(q, history, currentBook.title, context);
      setMessages([...next, { role: 'model', text: reply }]);
    } catch (e) {
      setMessages([
        ...next,
        { role: 'model', text: `⚠️ ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  // Clicking a chapter in the sidebar — behaviour depends on the active tab.
  const selectChapter = (idx: number) => {
    setSelected(idx);
    // On mobile the sidebar overlays the content — collapse it after a pick.
    if (typeof window !== 'undefined' && window.innerWidth < 640) setSidebarOpen(false);
    if (tab === 'summary') {
      if (idx === -1) genBookSummary();
      else analyze(idx);
    } else if (tab === 'chat' && idx >= 0 && chapters[idx]) {
      send(
        `Tell me about the chapter “${chapters[idx]!.title}” — its key points and significance.`,
      );
    } else if (isImageTab(tab)) {
      // Fresh preview for the newly selected chapter; load titbits via analysis.
      setMindmapUrl('');
      setVisualUrl('');
      setComicUrl('');
      setActiveTitbitId('');
      if (idx >= 0) analyze(idx);
    }
  };

  /** Switch tab; when landing on mindmap/visuals/comic with a chapter, load titbits. */
  const goTab = (next: Tab) => {
    setTab(next);
    if (isImageTab(next) && selected >= 0 && !analyses[selected] && chapters[selected]) {
      analyze(selected);
    }
  };

  const loadPrompts = async () => {
    if (prompts.length || converseBusy) return;
    setConverseBusy(true);
    try {
      setPrompts(await suggestConversePrompts(currentBook.title, bookText.slice(0, 4000)));
    } finally {
      setConverseBusy(false);
    }
  };

  /** Generate mind map / visual / comic from a specific chapter titbit. */
  const runImageFromTitbit = async (kind: ImageTab, titbit: Titbit) => {
    if (imgBusy || !imageConfigured) return;
    setImgBusy(true);
    setActiveTitbitId(titbit.id);
    setErr('');
    const chapterTitle =
      selected >= 0 && chapters[selected] ? chapters[selected]!.title : currentBook.title;
    try {
      let url: string;
      if (kind === 'mindmap') {
        const focus = `${titbit.detail}. Chapter: ${chapterTitle}. ${titbit.visualPrompt}`.slice(
          0,
          2000,
        );
        url = await generateMindMap(titbit.title, focus, currentBook.title);
        setMindmapUrl(url);
      } else if (kind === 'visuals') {
        url = await generateBookVisual(
          `A beautiful, atmospheric illustration of "${titbit.title}" from "${currentBook.title}" (chapter "${chapterTitle}"). ${titbit.visualPrompt}. Painterly, evocative, high detail, no text overlay.`,
        );
        setVisualUrl(url);
      } else {
        url = await generateBookVisual(
          `A vivid comic-book panel of "${titbit.title}" from "${currentBook.title}" (chapter "${chapterTitle}"). ${titbit.visualPrompt}. Bold ink lines, dynamic composition, dramatic lighting.`,
        );
        setComicUrl(url);
      }
      const kindLabel = kind === 'mindmap' ? 'Mind map' : kind === 'visuals' ? 'Visual' : 'Comic';
      addArtifact({
        id: `${kind}-${titbit.id}-${Date.now()}`,
        kind: `${kindLabel}: ${titbit.title}`,
        imageUrl: url,
        text: titbit.detail,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  };

  const VoicePicker = () =>
    voices.length > 0 ? (
      <select
        className='select select-bordered select-xs'
        value={voiceURI}
        onChange={(e) => setVoiceURI(e.target.value)}
      >
        <option value=''>Default voice</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    ) : null;

  const analysis = selected >= 0 ? analyses[selected] : null;
  const titbits = analysis ? buildTitbits(analysis) : [];
  const activeTitbitTitle = titbits.find((t) => t.id === activeTitbitId)?.title;

  return (
    <Dialog
      isOpen={!!book}
      onClose={close}
      boxClassName={
        maximized
          ? 'sm:!w-[96vw] sm:!max-w-[96vw] sm:!h-[94vh] sm:!max-h-[94vh]'
          : 'sm:!w-[760px] sm:!max-w-[96vw]'
      }
      contentClassName='!px-0'
      header={
        <div className='flex w-full items-center gap-2 px-4 py-1'>
          <AiInsightsMark size={24} className='shrink-0' />
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base' style={{ fontFamily: SERIF, fontWeight: 500 }}>
              {currentBook.title}
            </div>
            <div
              className='text-neutral-content truncate text-xs'
              style={{ fontFamily: SERIF, fontStyle: 'italic' }}
            >
              {currentBook.author || 'Insights'} · AI Insights{extracting ? ' · reading book…' : ''}
            </div>
          </div>
          <button
            className='btn btn-ghost btn-sm btn-circle shrink-0'
            onClick={showAIKeys}
            aria-label='AI keys and models'
            title='AI keys & models'
          >
            <HiOutlineKey className='h-5 w-5' />
          </button>
          <button
            className='btn btn-ghost btn-sm btn-circle hidden shrink-0 sm:flex'
            onClick={() => setMaximized((m) => !m)}
            aria-label={maximized ? 'Restore panel' : 'Maximize panel'}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? (
              <HiArrowsPointingIn className='h-5 w-5' />
            ) : (
              <HiArrowsPointingOut className='h-5 w-5' />
            )}
          </button>
          <button
            className='btn btn-ghost btn-sm btn-circle shrink-0'
            onClick={close}
            aria-label='Close panel'
            title='Close'
          >
            <HiXMark className='h-5 w-5' />
          </button>
        </div>
      }
    >
      <div className={`flex flex-col ${maximized ? 'h-[92vh]' : 'h-[78vh]'}`}>
        {/* Tab strip */}
        <div className='border-base-300 shrink-0 border-b px-2'>
          <div className='no-scrollbar -mx-1 flex gap-0 overflow-x-auto'>
            {TABS.map((t) => {
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => goTab(t.id)}
                  className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 transition-colors ${
                    isActive
                      ? `${t.text} ${t.active}`
                      : `border-transparent ${t.text} opacity-55 hover:opacity-90`
                  }`}
                >
                  <t.Icon className='h-4 w-4' />
                  <span
                    className='text-[13px]'
                    style={{
                      fontFamily: SERIF,
                      fontStyle: 'italic',
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    {t.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!configured && (
          <div className='bg-warning/15 text-warning-content mx-4 mt-2 rounded-md px-3 py-2 text-xs'>
            Add your AI key and choose a model to use AI Insights.{' '}
            <button className='link font-medium' onClick={showAIKeys}>
              Set up AI
            </button>
          </div>
        )}
        {configured && isImageTab(tab) && !imageConfigured && (
          <div className='bg-warning/15 text-warning-content mx-4 mt-2 rounded-md px-3 py-2 text-xs'>
            Pictures need the image bridge.{' '}
            <button className='link font-medium' onClick={showAIKeys}>
              Set it up
            </button>
          </div>
        )}
        {err && <div className='text-error mx-4 mt-2 text-sm'>{err}</div>}

        <div className='relative flex min-h-0 flex-1'>
          {/* Contents sidebar (chapter list) — collapsible; overlays on mobile */}
          {showSidebar && sidebarOpen && (
            <div
              className='absolute inset-0 z-10 bg-black/40 sm:hidden'
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {showSidebar && (
            <div
              className={`bg-base-200 border-base-300 z-20 flex shrink-0 flex-col overflow-hidden border-r transition-all duration-200 sm:bg-base-200/40 ${
                sidebarOpen
                  ? 'absolute inset-y-0 left-0 w-64 max-w-[80%] shadow-xl sm:static sm:w-52 sm:max-w-none sm:shadow-none'
                  : 'w-0 border-r-0'
              }`}
            >
              <div className='border-base-300 flex items-center justify-between border-b py-2 pl-4 pr-2'>
                <p className='text-outline text-[10px] uppercase tracking-[0.22em]'>Contents</p>
                <button
                  className='btn btn-ghost btn-xs px-1'
                  onClick={() => setSidebarOpen(false)}
                  aria-label='Collapse contents'
                >
                  <HiChevronLeft className='h-4 w-4' />
                </button>
              </div>
              <div className='no-scrollbar flex-1 overflow-y-auto p-2'>
                <button
                  onClick={() => selectChapter(-1)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${
                    selected === -1 ? 'bg-primary/10 text-primary' : 'hover:bg-base-300/50'
                  }`}
                >
                  <HiOutlineSparkles className='h-3.5 w-3.5 shrink-0' />
                  <span
                    className='text-[13px]'
                    style={{
                      fontFamily: SERIF,
                      fontStyle: 'italic',
                      fontWeight: selected === -1 ? 500 : 400,
                    }}
                  >
                    Book overview
                  </span>
                </button>
                <div className='text-outline/70 mb-1 mt-3 px-3 text-[10px] uppercase tracking-[0.22em]'>
                  {chapters.length} chapters
                </div>
                {chapters.length > 0 ? (
                  chapters.map((c) => {
                    const active = selected === c.idx;
                    return (
                      <button
                        key={c.idx}
                        onClick={() => selectChapter(c.idx)}
                        className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors ${
                          active ? 'bg-primary/10 text-primary' : 'hover:bg-base-300/50'
                        }`}
                      >
                        <span className='text-outline/60 w-5 shrink-0 text-right text-[10px] tabular-nums'>
                          {c.idx + 1}
                        </span>
                        <span
                          className='flex-1 truncate text-[12.5px]'
                          style={{
                            fontFamily: SERIF,
                            fontStyle: 'italic',
                            fontWeight: active ? 500 : 400,
                          }}
                        >
                          {c.title}
                        </span>
                        {analyses[c.idx] && (
                          <HiOutlineSparkles className='text-primary/70 h-3 w-3 shrink-0' />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p
                    className='text-outline/60 px-3 py-6 text-center text-[12px]'
                    style={{ fontFamily: SERIF, fontStyle: 'italic' }}
                  >
                    {extracting ? 'Reading book…' : 'No chapters found in this book'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Main content */}
          <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
            {/* Contents toggle bar (shows which section is active). Hidden on
                mobile while the drawer is open so it doesn't peek beside it. */}
            {showSidebar && (
              <div
                className={`border-base-300 shrink-0 items-center gap-2 border-b px-2 py-1.5 ${
                  sidebarOpen ? 'hidden sm:flex' : 'flex'
                }`}
              >
                <button
                  className='btn btn-ghost btn-xs gap-1 px-1.5'
                  onClick={() => setSidebarOpen((o) => !o)}
                  aria-label='Toggle contents'
                >
                  <HiOutlineBars3 className='h-4 w-4' />
                  <span className='text-[11px]'>Contents</span>
                </button>
                <span
                  className='text-outline min-w-0 truncate text-[12px]'
                  style={{ fontFamily: SERIF, fontStyle: 'italic' }}
                >
                  {selected >= 0 ? chapters[selected]?.title : 'Book overview'}
                </span>
              </div>
            )}
            {/* SUMMARY */}
            {tab === 'summary' && (
              <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4'>
                {busy && (
                  <div className='flex items-center gap-2 text-sm'>
                    <span className='loading loading-spinner loading-sm' /> Analyzing…
                  </div>
                )}
                {/* Book overview */}
                {selected === -1 && (
                  <>
                    {!summary && !busy && (
                      <button
                        className='btn btn-primary btn-sm'
                        onClick={genBookSummary}
                        disabled={!configured || extracting}
                      >
                        Generate book overview
                      </button>
                    )}
                    {summary && (
                      <div className='space-y-3'>
                        <div className='flex items-center gap-2'>
                          <span className='badge badge-outline'>{summary.genre}</span>
                          <button
                            className='btn btn-ghost btn-xs'
                            onClick={() => speak(summary.summary)}
                          >
                            {speaking ? '■ Stop' : '▶ Listen'}
                          </button>
                          <VoicePicker />
                        </div>
                        <p className='text-[15px] leading-relaxed' style={{ fontFamily: SERIF }}>
                          <MathText text={summary.summary} />
                        </p>
                        {summary.keyTakeaways.length > 0 && (
                          <ul className='list-disc space-y-1 pl-5 text-sm'>
                            {summary.keyTakeaways.map((t, i) => (
                              <li key={i}>
                                <MathText text={t} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                )}
                {/* Chapter analysis */}
                {selected >= 0 && !analysis && !busy && (
                  <button
                    className='btn btn-primary btn-sm'
                    onClick={() => analyze(selected)}
                    disabled={!configured}
                  >
                    Analyze “{chapters[selected]?.title}”
                  </button>
                )}
                {selected >= 0 && analysis && (
                  <div className='space-y-6'>
                    <section className='space-y-2'>
                      <div className='flex items-center gap-2'>
                        <h4 className='text-outline text-[10px] uppercase tracking-[0.22em]'>
                          Overview
                        </h4>
                        <button
                          className='btn btn-ghost btn-xs'
                          onClick={() => speak(analysis.overview)}
                        >
                          {speaking ? '■ Stop' : '▶ Listen'}
                        </button>
                        <VoicePicker />
                      </div>
                      <p className='text-[15px] leading-relaxed' style={{ fontFamily: SERIF }}>
                        <MathText text={analysis.overview} />
                      </p>
                    </section>
                    {analysis.importantQuotes?.length > 0 && (
                      <section className='space-y-3'>
                        <h4 className='text-outline text-[10px] uppercase tracking-[0.22em]'>
                          Key quotes
                        </h4>
                        {analysis.importantQuotes.map((q, i) => (
                          <blockquote
                            key={i}
                            className='border-amber-600/40 border-l-2 pl-4 text-[15px] italic leading-relaxed'
                            style={{ fontFamily: SERIF }}
                          >
                            “<MathText text={q} />”
                          </blockquote>
                        ))}
                      </section>
                    )}
                    {analysis.keyThemes?.length > 0 && (
                      <section className='space-y-2'>
                        <h4 className='text-outline text-[10px] uppercase tracking-[0.22em]'>
                          Themes
                        </h4>
                        {/* Themes are full "Title: description" sentences, so
                            render as wrapping blocks — badges (fixed height,
                            no-wrap) made long ones collapse and overlap. */}
                        <div className='space-y-1.5'>
                          {analysis.keyThemes.map((t, i) => {
                            const ci = t.indexOf(':');
                            const title = ci > 0 ? t.slice(0, ci) : '';
                            const desc = ci > 0 ? t.slice(ci + 1).trim() : t;
                            return (
                              <p
                                key={i}
                                className='text-[14px] leading-relaxed'
                                style={{ fontFamily: SERIF }}
                              >
                                {title && <span className='font-medium not-italic'>{title}: </span>}
                                <span style={{ fontStyle: 'italic' }}>
                                  <MathText text={desc} />
                                </span>
                              </p>
                            );
                          })}
                        </div>
                      </section>
                    )}
                    {analysis.concepts?.length > 0 && (
                      <section className='space-y-2'>
                        <h4 className='text-outline text-[10px] uppercase tracking-[0.22em]'>
                          Concepts
                        </h4>
                        <ul className='list-disc space-y-1 pl-5 text-sm'>
                          {analysis.concepts.map((c, i) => (
                            <li key={i}>
                              <MathText text={c} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* CHAT */}
            {tab === 'chat' && (
              <div className='flex min-h-0 flex-1 flex-col'>
                <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4'>
                  {messages.length === 0 && (
                    <p className='text-neutral-content text-sm'>
                      Ask anything about “{currentBook.title}”
                      {selected >= 0 && chapters[selected]
                        ? ` — chatting about “${chapters[selected]!.title}”`
                        : ''}
                      . Pick a chapter on the left to focus.
                    </p>
                  )}
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`chat ${m.role === 'user' ? 'chat-end' : 'chat-start'}`}
                    >
                      <div
                        className={`chat-bubble text-sm ${m.role === 'user' ? 'chat-bubble-primary' : ''}`}
                      >
                        <MathText text={m.text} />
                      </div>
                    </div>
                  ))}
                  {chatBusy && (
                    <div className='chat chat-start'>
                      <div className='chat-bubble'>
                        <span className='loading loading-dots loading-sm' />
                      </div>
                    </div>
                  )}
                </div>
                <div className='border-base-300 flex shrink-0 gap-2 border-t px-5 py-3'>
                  <input
                    className='input input-bordered input-sm flex-1'
                    placeholder='Ask about this book…'
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send(chatInput)}
                    disabled={!configured}
                  />
                  <button
                    className='btn btn-primary btn-sm'
                    onClick={() => send(chatInput)}
                    disabled={!configured || chatBusy}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {/* CONVERSE */}
            {tab === 'converse' && (
              <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4'>
                {prompts.length === 0 ? (
                  <button
                    className='btn btn-primary btn-sm'
                    onClick={loadPrompts}
                    disabled={!configured || converseBusy}
                  >
                    {converseBusy ? 'Thinking…' : 'Suggest questions'}
                  </button>
                ) : (
                  prompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => send(p)}
                      className='border-base-300 hover:bg-base-200 block w-full rounded-lg border px-3 py-2 text-left text-sm'
                      style={{ fontFamily: SERIF, fontStyle: 'italic' }}
                    >
                      {p}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* AUDIO */}
            {tab === 'audio' && (
              <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4'>
                <div className='flex flex-wrap items-center gap-2'>
                  <VoicePicker />
                  <button
                    className='btn btn-primary btn-sm'
                    onClick={() =>
                      speak(analysis?.overview || summary?.summary || bookText.slice(0, 1200))
                    }
                  >
                    {speaking ? '■ Stop' : '▶ Listen'}
                  </button>
                </div>
                <p className='text-neutral-content text-xs'>
                  Reads the selected chapter analysis or book summary if generated, else the opening
                  of the book.
                </p>
                {(analysis?.overview || summary?.summary) && (
                  <p className='text-sm leading-relaxed' style={{ fontFamily: SERIF }}>
                    <MathText text={analysis?.overview || summary?.summary || ''} />
                  </p>
                )}
              </div>
            )}

            {/* MIND MAP / VISUALS / COMIC — chapter titbits → generate on tap */}
            {isImageTab(tab) && (
              <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4'>
                {selected < 0 && (
                  <p
                    className='text-neutral-content text-sm leading-relaxed'
                    style={{ fontFamily: SERIF, fontStyle: 'italic' }}
                  >
                    Select a chapter from Contents. You&apos;ll get key moments (scenes, themes,
                    concepts, quotes) — tap one to generate a {IMAGE_KIND_LABEL[tab]}.
                  </p>
                )}

                {selected >= 0 && !analysis && busy && (
                  <div className='flex items-center gap-2 text-sm'>
                    <span className='loading loading-spinner loading-sm' /> Finding key moments in “
                    {chapters[selected]?.title}”…
                  </div>
                )}

                {selected >= 0 && !analysis && !busy && (
                  <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    onClick={() => analyze(selected)}
                    disabled={!configured || !chapters[selected]}
                  >
                    Load moments from “{chapters[selected]?.title}”
                  </button>
                )}

                {selected >= 0 && analysis && (
                  <>
                    <div>
                      <p className='text-outline text-[10px] uppercase tracking-[0.22em]'>
                        Key moments · {chapters[selected]?.title}
                      </p>
                      <p
                        className='text-neutral-content mt-1 text-xs'
                        style={{ fontFamily: SERIF, fontStyle: 'italic' }}
                      >
                        Tap a titbit to generate a {IMAGE_KIND_LABEL[tab]}.
                      </p>
                    </div>

                    {titbits.length === 0 ? (
                      <p className='text-neutral-content text-sm'>
                        No moments found for this chapter. Try another chapter.
                      </p>
                    ) : (
                      <ul className='flex flex-col gap-2'>
                        {titbits.map((t) => {
                          const isActive = activeTitbitId === t.id;
                          const isGenerating = imgBusy && isActive;
                          return (
                            <li key={t.id}>
                              <button
                                type='button'
                                onClick={() => runImageFromTitbit(tab, t)}
                                disabled={!imageConfigured || imgBusy}
                                className={`border-base-300 hover:bg-base-200 active:bg-base-300 w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                                  isActive
                                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                                    : ''
                                }`}
                              >
                                <div className='flex items-start gap-2'>
                                  <span className='badge badge-ghost badge-sm shrink-0 font-normal'>
                                    {TITBIT_KIND_LABEL[t.kind]}
                                  </span>
                                  <div className='min-w-0 flex-1'>
                                    <div
                                      className='text-[13.5px] leading-snug'
                                      style={{
                                        fontFamily: SERIF,
                                        fontWeight: isActive ? 500 : 400,
                                      }}
                                    >
                                      <MathText text={t.title} />
                                    </div>
                                    {t.detail && t.detail !== t.title && (
                                      <p className='text-neutral-content mt-0.5 line-clamp-2 text-[12px] leading-snug'>
                                        <MathText text={t.detail} />
                                      </p>
                                    )}
                                  </div>
                                  {isGenerating ? (
                                    <span className='loading loading-spinner loading-xs shrink-0' />
                                  ) : (
                                    <span className='text-outline shrink-0 text-[11px] opacity-70'>
                                      →
                                    </span>
                                  )}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}

                {imgBusy && (
                  <div className='flex items-center gap-2 text-sm'>
                    <span className='loading loading-spinner loading-sm' /> Generating{' '}
                    {IMAGE_KIND_LABEL[tab]} in {IMAGE_PROVIDER_LABELS[imageProvider]}…
                  </div>
                )}

                {tab === 'mindmap' && mindmapUrl && (
                  <AiImageFrame src={mindmapUrl} alt='Mind map' caption={activeTitbitTitle} />
                )}
                {tab === 'visuals' && visualUrl && (
                  <AiImageFrame src={visualUrl} alt='Visual' caption={activeTitbitTitle} />
                )}
                {tab === 'comic' && comicUrl && (
                  <AiImageFrame src={comicUrl} alt='Comic' caption={activeTitbitTitle} />
                )}
              </div>
            )}

            {/* STORED */}
            {tab === 'stored' && (
              <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4'>
                {artifacts.length === 0 && (
                  <p className='text-neutral-content text-sm'>Nothing generated yet.</p>
                )}
                {artifacts.map((a) => (
                  <div key={a.id} className='border-base-300 rounded-lg border p-3'>
                    <div className='mb-1 text-[10px] uppercase tracking-wide opacity-60'>
                      {a.kind}
                    </div>
                    {a.text && <p className='line-clamp-3 text-sm'>{a.text}</p>}
                    {a.imageUrl && (
                      <div className='mt-1'>
                        <AiImageFrame src={a.imageUrl} alt={a.kind} compact />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default AiPanel;
