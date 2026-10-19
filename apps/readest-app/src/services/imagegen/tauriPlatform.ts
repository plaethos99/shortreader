/**
 * The image engine's Platform in the desktop app: the native
 * `launch_image_browser` command opens Edge or Chrome for the site, and the
 * DevTools protocol is spoken through Tauri's HTTP and WebSocket plugins,
 * which run in Rust (no browser origin rules, nothing for web pages to reach).
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import TauriWebSocket from '@tauri-apps/plugin-websocket';

import type { Connection, ImageProvider, Platform, Tab } from './core';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // Chunked: String.fromCharCode takes its arguments on the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

export const createTauriPlatform = (): Platform => ({
  async launch(site: ImageProvider) {
    // The native side knows each site's address and port.
    await invoke('launch_image_browser', { siteName: site });
  },

  async tabs(port: number) {
    try {
      const res = await tauriFetch(`http://127.0.0.1:${port}/json`, { connectTimeout: 1500 });
      return (await res.json()) as Tab[];
    } catch {
      return null;
    }
  },

  async openTab(port: number, url: string) {
    await tauriFetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
  },

  async connect(tab: Tab): Promise<Connection> {
    const ws = await TauriWebSocket.connect(tab.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map<
      number,
      { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
    >();
    const unlisten = ws.addListener((msg) => {
      if (msg.type === 'Close') {
        pending.forEach(({ reject }) => reject(new Error('The browser tab closed')));
        pending.clear();
        return;
      }
      if (msg.type !== 'Text') return;
      const reply = JSON.parse(msg.data) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message: string };
      };
      const waiter = reply.id === undefined ? undefined : pending.get(reply.id);
      if (!waiter) return;
      pending.delete(reply.id!);
      if (reply.error) waiter.reject(new Error(reply.error.message));
      else waiter.resolve(reply.result ?? {});
    });
    return {
      send: (method, params = {}) =>
        new Promise((resolve, reject) => {
          const mine = ++id;
          pending.set(mine, { resolve, reject });
          ws.send(JSON.stringify({ id: mine, method, params })).catch((e) => {
            pending.delete(mine);
            reject(e instanceof Error ? e : new Error(String(e)));
          });
        }),
      close: () => {
        unlisten();
        void ws.disconnect().catch(() => {});
      },
    };
  },

  async download(url: string) {
    const res = await tauriFetch(url);
    if (!res.ok) throw new Error(`Could not download the picture (${res.status})`);
    return {
      mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
      data: toBase64(new Uint8Array(await res.arrayBuffer())),
    };
  },
});
