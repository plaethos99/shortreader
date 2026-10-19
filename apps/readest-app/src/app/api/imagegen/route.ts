/**
 * Pictures for the web app, made on this computer: opens Google Flow or Grok
 * Imagine in its own Edge/Chrome window, waits while the reader signs in, and
 * makes the picture (services/imagegen/core).
 *
 * Only for a web app running on the reader's own computer (`pnpm dev-web`, or
 * a self-hosted server they reach on localhost): it opens a browser window
 * where the server runs, so it refuses requests from anywhere else. Not in the
 * desktop build (only .tsx pages are exported); the desktop app drives the
 * browser itself.
 *
 * The reply streams NDJSON: `{"status": "…"}` lines while it waits (signing
 * in, making the picture), then `{"image": {"mimeType", "data"}}` or
 * `{"error": "…"}`.
 */
import { NextRequest, NextResponse } from 'next/server';

import {
  IMAGE_ASPECTS,
  makeImage,
  openSite,
  siteState,
  type ImageAspect,
  type ImageProvider,
} from '@/services/imagegen/core';
import { createNodePlatform } from '@/services/imagegen/nodePlatform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Waiting for the reader to sign in can take minutes.
export const maxDuration = 900;

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// The app's own page on this computer, and nothing else: a web page the reader
// happens to visit must not be able to drive their Flow or Grok account.
const isLocal = (request: NextRequest) => {
  const host = request.headers.get('host') ?? '';
  if (!LOCAL_HOSTS.test(host)) return false;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded?.split(',').some((ip) => !/^(127\.|::1)/.test(ip.trim()))) return false;
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== host) return false;
  if (request.method === 'POST' && !request.headers.get('content-type')?.includes('json')) {
    return false;
  }
  return true;
};

const PROVIDERS: ImageProvider[] = ['flow', 'imagine'];

let platform: ReturnType<typeof createNodePlatform> | null = null;
const getPlatform = () => (platform ??= createNodePlatform());

const notHere = () =>
  NextResponse.json(
    {
      error:
        'Pictures are made in a browser window on your own computer. Use the ShortReader desktop app, or run the web app on your computer.',
    },
    { status: 403 },
  );

/** Each provider's window: closed, waiting for sign-in, or ready. */
export async function GET(request: NextRequest) {
  if (!isLocal(request)) return notHere();
  const p = getPlatform();
  return NextResponse.json({
    flow: await siteState(p, 'flow'),
    imagine: await siteState(p, 'imagine'),
  });
}

export async function POST(request: NextRequest) {
  if (!isLocal(request)) return notHere();
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'open' | 'generate';
    provider?: ImageProvider;
    prompt?: string;
    aspect?: ImageAspect;
  };
  const provider = body.provider;
  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: 'provider must be flow or imagine' }, { status: 400 });
  }
  if (body.action === 'open') {
    await openSite(getPlatform(), provider);
    return NextResponse.json({ ok: true });
  }
  const aspect = body.aspect ?? '16:9';
  if (!IMAGE_ASPECTS.includes(aspect)) {
    return NextResponse.json(
      { error: `aspect must be one of ${IMAGE_ASPECTS.join(', ')}` },
      { status: 400 },
    );
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // The client already went away.
        }
      };
      try {
        // Stops waiting for sign-in when the page goes away or the request is cancelled.
        const image = await makeImage(
          getPlatform(),
          provider,
          prompt,
          aspect,
          (status) => line({ status }),
          request.signal,
        );
        line({ image });
      } catch (e) {
        line({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
