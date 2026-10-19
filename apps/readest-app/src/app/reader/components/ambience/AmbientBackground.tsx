'use client';

/**
 * The calm moving background behind the feed and focus mode.
 *
 * It tints the page's own colour (read from the parent's background) instead
 * of replacing it, so text keeps its theme contrast: deep colour washes in a
 * dark theme, pale ones in a light theme. Drawn on one canvas at half
 * resolution and ~30 fps — soft gradients lose nothing — and paused whenever
 * the page is hidden, to spare a phone's battery. Under "reduce motion" it
 * draws a single still frame; under e-ink, nothing at all.
 */
import React, { useEffect, useRef } from 'react';

import type { Backdrop } from '@/services/scrollfeed/ambience';

interface AmbientBackgroundProps {
  backdrop: Backdrop;
  palette: string[];
}

const FRAME_MS = 33;
const RESOLUTION = 0.5;
// The moment a still (reduced-motion) background is drawn at.
const STILL_TIME_MS = 20000;

export const isEinkMode = () =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-eink') === 'true';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const parseRgb = (css: string): [number, number, number] => {
  const m = css.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
};

// Alpha as two hex digits, for appending to a #rrggbb colour.
const hexAlpha = (a: number) =>
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');

interface Scene {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  t: number;
  base: string;
  dark: boolean;
  palette: string[];
  // Strength of the colour washes: stronger on a dark page.
  wash: number;
  motes: { x: number; y: number; r: number; v: number; p: number }[];
  grain: CanvasPattern | null;
}

const radial = (s: Scene, x: number, y: number, r: number, color: string, alpha: number) => {
  const g = s.ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + hexAlpha(alpha));
  g.addColorStop(1, `${color}00`);
  s.ctx.fillStyle = g;
  s.ctx.fillRect(0, 0, s.w, s.h);
};

const DRAW: Record<Exclude<Backdrop, 'plain'>, (s: Scene) => void> = {
  // Three slow colour fields drifting past each other.
  aurora: (s) => {
    const spots: [number, number][] = [
      [0.3, 0.7],
      [0.8, 0.3],
      [0.5, 0.9],
    ];
    spots.forEach(([px, py], i) => {
      const x = s.w * (px + 0.25 * Math.sin(s.t * 0.07 + i * 2));
      const y = s.h * (py + 0.2 * Math.cos(s.t * 0.05 + i));
      radial(s, x, y, Math.max(s.w, s.h) * 0.55, s.palette[i]!, 0.8 * s.wash);
    });
  },
  // Swells over 4 s and fades over 6 s: the pace of a slow, calming breath.
  breathe: (s) => {
    const phase = s.t % 10;
    const k = phase < 4 ? phase / 4 : 1 - (phase - 4) / 6;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    const r = Math.min(s.w, s.h) * (0.45 + 0.5 * e);
    radial(s, s.w / 2, s.h * 0.55, r, s.palette[1]!, 0.85 * s.wash);
    radial(s, s.w / 2, s.h * 0.55, r * 1.4, s.palette[0]!, 0.35 * s.wash);
  },
  // Paper texture under a light that slowly shifts across the page.
  grain: (s) => {
    const x = s.w * (0.5 + 0.3 * Math.sin(s.t * 0.05));
    radial(s, x, s.h * 0.3, Math.max(s.w, s.h) * 0.7, s.palette[0]!, 0.5 * s.wash);
    if (s.grain) {
      s.ctx.fillStyle = s.grain;
      s.ctx.fillRect(0, 0, s.w, s.h);
    }
  },
  // Specks of light rising like dust in a sunbeam.
  motes: (s) => {
    const g = s.ctx.createLinearGradient(0, 0, 0, s.h);
    g.addColorStop(0, s.palette[0]! + hexAlpha(0.7 * s.wash));
    g.addColorStop(1, `${s.palette[0]!}00`);
    s.ctx.fillStyle = g;
    s.ctx.fillRect(0, 0, s.w, s.h);
    const speck = s.dark ? '255,240,210' : '120,100,70';
    for (const m of s.motes) {
      m.y -= m.v;
      if (m.y < -4) {
        m.y = s.h + 4;
        m.x = Math.random() * s.w;
      }
      s.ctx.fillStyle = `rgba(${speck},${0.2 + 0.2 * Math.sin(s.t + m.p)})`;
      s.ctx.beginPath();
      s.ctx.arc(m.x + 4 * Math.sin(s.t * 0.3 + m.p), m.y, m.r, 0, Math.PI * 2);
      s.ctx.fill();
    }
  },
  // Fine lines undulating slowly across the page.
  waves: (s) => {
    radial(s, s.w * 0.2, s.h * 0.2, Math.max(s.w, s.h), s.palette[0]!, 0.6 * s.wash);
    radial(s, s.w * 0.9, s.h * 0.9, Math.max(s.w, s.h) * 0.8, s.palette[2]!, 0.45 * s.wash);
    const line = s.dark ? '255,255,255' : '0,0,0';
    s.ctx.lineWidth = 0.7;
    const rows = 14;
    for (let k = 0; k < rows; k++) {
      s.ctx.strokeStyle = `rgba(${line},${0.04 + 0.02 * Math.sin(k)})`;
      s.ctx.beginPath();
      const base = ((k + 0.5) / rows) * s.h;
      for (let x = 0; x <= s.w; x += 6) {
        const y =
          base + 9 * Math.sin(x / 45 + s.t * 0.35 + k * 0.6) + 5 * Math.sin(x / 18 - s.t * 0.2);
        if (x === 0) s.ctx.moveTo(x, y);
        else s.ctx.lineTo(x, y);
      }
      s.ctx.stroke();
    }
  },
  // The page colour, with the faintest pulse of colour at the edges.
  focus: (s) => {
    const pulse = 0.5 + 0.5 * Math.sin(s.t * 0.6);
    const g = s.ctx.createRadialGradient(
      s.w / 2,
      s.h / 2,
      Math.min(s.w, s.h) * 0.45,
      s.w / 2,
      s.h / 2,
      Math.max(s.w, s.h) * 0.75,
    );
    g.addColorStop(0, `${s.palette[1]!}00`);
    g.addColorStop(1, s.palette[1]! + hexAlpha((0.1 + 0.15 * pulse) * s.wash));
    s.ctx.fillStyle = g;
    s.ctx.fillRect(0, 0, s.w, s.h);
  },
};

const makeGrain = (ctx: CanvasRenderingContext2D, dark: boolean): CanvasPattern | null => {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const img = tctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = dark ? 16 : 12;
  }
  tctx.putImageData(img, 0, 0);
  return ctx.createPattern(tile, 'repeat');
};

const AmbientBackground: React.FC<AmbientBackgroundProps> = ({ backdrop, palette }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteKey = palette.join(',');

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || backdrop === 'plain') return;

    const baseCss = getComputedStyle(canvas.parentElement ?? document.body).backgroundColor;
    const [r, g, b] = parseRgb(baseCss);
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    const scene: Scene = {
      ctx,
      w: 0,
      h: 0,
      t: 0,
      base: `rgb(${r},${g},${b})`,
      dark,
      palette: paletteKey.split(','),
      wash: dark ? 1 : 0.35,
      motes: [],
      grain: backdrop === 'grain' ? makeGrain(ctx, dark) : null,
    };

    const still = prefersReducedMotion();
    const resize = () => {
      scene.w = canvas.width = Math.max(1, Math.round(canvas.clientWidth * RESOLUTION));
      scene.h = canvas.height = Math.max(1, Math.round(canvas.clientHeight * RESOLUTION));
      scene.motes = Array.from({ length: 40 }, () => ({
        x: Math.random() * scene.w,
        y: Math.random() * scene.h,
        r: Math.random() * 1.2 + 0.4,
        v: Math.random() * 0.12 + 0.04,
        p: Math.random() * 6,
      }));
      // Resizing clears the canvas; a still background has no next frame.
      if (still) drawFrame(STILL_TIME_MS);
    };
    const drawFrame = (ms: number) => {
      scene.t = ms / 1000;
      ctx.fillStyle = scene.base;
      ctx.fillRect(0, 0, scene.w, scene.h);
      DRAW[backdrop](scene);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let last = 0;
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (ms - last < FRAME_MS) return;
      last = ms;
      drawFrame(ms);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (still) drawFrame(STILL_TIME_MS);
      else if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [backdrop, paletteKey]);

  if (backdrop === 'plain' || isEinkMode()) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 h-full w-full'
    />
  );
};

export default AmbientBackground;
