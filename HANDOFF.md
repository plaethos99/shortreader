# ShortReader — developer handoff

How the code is laid out, how to run it, how to build it, and how to publish a
release on GitHub. Written 2026-10-19; current as of release
`shortreader-v0.1.2`.

---

## 1. What ShortReader is

ShortReader is an AI ebook reader built on [Readest](https://github.com/readest/readest)
(AGPL-3.0, Next.js 16 + Tauri v2). On top of Readest it adds:

- **Curated feed** — every chapter retold as a scroll of cards, in the reader's
  language, with read-aloud.
- **AI Insights** — book summary, chapter overviews, quotes, themes, chat with
  the book, conversation prompts.
- **Listen** — the book as an hour-long audio story.
- **Pictures** — mind maps, chapter visuals, comic panels and feed pictures,
  made in **Google Flow** or **Grok Imagine** (reader's choice).
- **Bring your own key** — no AI key is built in. Each reader picks a service
  and model in **Settings → AI Keys** and pastes their own key.

It runs as a web app, a Windows/macOS/Linux desktop app, and an Android/iOS
app. Releases ship **Windows** (installer + portable), **macOS** (universal dmg)
and **Android** (arm64 APK). The first time a book is opened the reader picks
**Original book** or **Curated view**; the choice is remembered per book.

---

## 2. Repository layout

```
shortreader/
├─ apps/
│  └─ readest-app/                 ← THE app (Next.js front end + Tauri shell)
│     ├─ src/                      ← all TypeScript/React code (see §3)
│     ├─ src-tauri/                ← Rust side of the desktop/mobile app
│     │  ├─ src/                   ← Rust commands (lib.rs registers them)
│     │  ├─ capabilities/          ← Tauri permission sets (default.json)
│     │  ├─ gen/android/           ← customised Android project files (tracked)
│     │  ├─ tauri.conf.json        ← upstream Readest config
│     │  ├─ shortreader.conf.json  ← desktop overlay: name + app id
│     │  └─ shortreader.android.conf.json ← Android overlay: name
│     ├─ public/                   ← static assets; public/vendor is generated
│     ├─ scripts/                  ← build helpers (tauri wrapper, android, …)
│     ├─ docs/DEPLOYMENT.md        ← env vars, Android build, troubleshooting
│     ├─ .env.web.example          ← copy to .env.web   (web app)
│     └─ .env.tauri.example        ← copy to .env.tauri (desktop/mobile)
├─ packages/                       ← vendored dependencies (foliate-js, tauri
│                                     fork, tauri-plugins, simplecc-wasm, …)
├─ tools/
│  └─ image-bridge/                ← picture bridge for phones + MCP server
├─ docs/screenshots/               ← README screenshots
├─ .github/workflows/
│  └─ shortreader-release.yml      ← THE release workflow (others: see §8.6)
├─ Cargo.toml / Cargo.lock         ← Rust workspace
├─ package.json / pnpm-lock.yaml   ← pnpm workspace (pnpm 11.1.1)
└─ HANDOFF.md                      ← this file
```

`packages/*` are plain files in this repo (not git submodules), even though
`.gitmodules` still lists them from upstream.

---

## 3. Source code guide

Paths below are relative to `apps/readest-app/src/`. Upstream Readest code
(the reader itself, library, sync, TTS engines, settings) is unchanged unless
listed here.

### 3.1 Bring-your-own-key AI (text)

| File | What it does |
| --- | --- |
| `services/byok/providers.ts` | The list of supported text services: OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Groq, Mistral, Together, Ollama, and "Other OpenAI-compatible". Base URL, dialect, key link, suggested model. |
| `services/byok/aiConfig.ts` | The reader's AI settings (zustand store, saved to `localStorage` key `shortreader.ai-config`): chosen service, a key and model **per service**, custom base URLs, "answer without thinking", picture provider, bridge address/token. `resolveTextConfig()` / `textConfigProblem()` / `isTextAIConfigured()`. |
| `services/llm.ts` | The single text client every AI feature uses: `chatText`, `chatJson`, `chatImage` (OCR), `listModels`, `testTextModel`. Speaks two dialects: OpenAI chat-completions and Anthropic Messages. Sends optional extras (JSON mode, "no thinking", reply cap) and **retries once without them on HTTP 400/422**, so any model works. Parses JSON leniently. |
| `components/settings/AIKeysSettings.tsx` | The **AI Keys** screen (service, key, model with "Load models", Test; picture provider with Open/Check). |
| `components/AIKeysDialog.tsx` | Opens that screen as a dialog from anywhere: `showAIKeys()`. Mounted on the library page and in the reader. |

Keys never leave the device except to the chosen service. Desktop/mobile send
requests through Tauri's HTTP plugin (no CORS); the web app uses `fetch`.

### 3.2 AI features (use `llm.ts`)

| File | Feature |
| --- | --- |
| `services/luminaAI.ts` | AI Insights: book summary, chapter analysis, chat, explain, translate, conversation prompts; `generateMindMap` / `generateBookVisual` for pictures. |
| `app/library/components/AiPanel.tsx` | The AI Insights panel UI (tabs: summary, chat, converse, audio, mind map, visuals, comic, stored). |
| `services/scrollfeed/` | The curated feed: `generate.ts` (cards per chapter), `genre.ts` (story/concepts/… style), `language.ts`, `audiostory.ts` (Listen), `ocr.ts` (scanned pages → text via a vision model), `store.ts` (cache). |
| `app/reader/components/scrollfeed/` | Feed UI (`ScrollFeedView.tsx`, `ScrollFeedCard.tsx`, `AudioStoryPanel.tsx`, …). |
| `utils/mathText.ts`, `components/MathText.tsx`, `components/MarkdownText.tsx` | Rendering AI text: Markdown (headings, lists, bold, tables) + LaTeX math as MathML, sanitized with DOMPurify. `MarkdownText` for replies, `MathText` for short items. `mathToSpeech` makes read-aloud skip Markdown marks and speak equations. |

### 3.2b Reading mode and the curated view's window bar

| File | What it does |
| --- | --- |
| `services/readingMode.ts` | Per-book choice `original` / `curated`, in `localStorage` key `shortreader.reading-mode`. |
| `app/reader/components/ReadingModeChooser.tsx` | The "How would you like to read…" screen on a book's first open. Rendered by `BooksGrid.tsx` while no choice is saved. |
| `store/readerStore.ts` | Opens each book in its saved mode (`scrollFeed = mode === 'curated'`). |
| `app/reader/hooks/useScrollFeedSetting.ts` | The view toggle; also saves the choice. |
| `app/reader/components/scrollfeed/FeedWindowBar.tsx` | Desktop only. The curated view (and the chooser) cover the reader's header, which holds the window buttons, so they draw their own bar: minimize / maximize / close on Windows and Linux, the traffic lights on macOS, a drag strip and the title. Renders nothing on phones. |

### 3.3 Pictures (Google Flow / Grok Imagine)

Neither service has a public API for this, so pictures are made **the way a
person would**: the site opens in a real Microsoft Edge or Google Chrome window
with its own profile, the reader signs in once, and the app drives the page
over the Chrome DevTools protocol.

| File | Role |
| --- | --- |
| `services/imagegen/core.ts` | **The engine.** `makeImage(platform, provider, prompt, aspect, onProgress, signal)`: opens the window if needed → waits (≤10 min) for sign-in → for Flow presses "New project" itself → types the prompt → native click on generate → waits for the new picture. Also `siteState`, `openSite`. Contains the **page driver scripts** (`FLOW_DRIVER`, `GROK_DRIVER`, `GROK_SIGNED_IN`) — strings evaluated in the page. Self-contained (no imports) so Node can run it directly. |
| `services/imagegen/tauriPlatform.ts` | Engine transport for the **desktop app**: native `launch_image_browser` command + Tauri HTTP/WebSocket plugins. |
| `services/imagegen/nodePlatform.ts` | Engine transport on **Node**: spawns Edge/Chrome, speaks DevTools with Node's WebSocket. Used by the web route and the bridge. |
| `app/api/imagegen/route.ts` | Web app's **local-only** route. `GET` = status, `POST {action:'open'}` = open window, `POST {provider,prompt,aspect}` = make a picture, streamed as NDJSON (`{status}` lines then `{image}` or `{error}`). Refuses non-localhost hosts, foreign `Origin`s and non-JSON posts. Not included in desktop builds (only `.tsx` pages are exported). |
| `services/imageBridge.ts` | What the UI calls. `imageRoute()` picks **desktop** (drive the browser itself), **web** (the route above) or **bridge** (phones → `tools/image-bridge` on a computer). `generateImage`, `imageStatus`, `openImageProvider`, `isImageGenConfigured`. |
| `src-tauri/src/image_browser.rs` | Rust command `launch_image_browser(site_name)`: finds Edge/Chrome, launches it with `--remote-debugging-port` and a profile under the app data dir. The **site URL and port are fixed in Rust** (flow → `https://flow.google.com/`, port 9434; imagine → `https://grok.com/imagine`, port 9460). Keep in sync with `SITES` in `core.ts`. Registered in `lib.rs`, listed in `build.rs`, permitted by `allow-launch-image-browser` in `capabilities/default.json`. |
| `tools/image-bridge/` | Plain Node (≥22.18, no dependencies). `bridge.mjs` = HTTP server for phones (port 7531) and, with `--mcp`, an MCP server for agents (`generate_image`, `open_provider`, `provider_status`). Imports the app's `core.ts`/`nodePlatform.ts` directly. See its README. |

Browser profiles: desktop app → `<app data dir>/image-browser/<site>-profile`;
web route and bridge → `%LOCALAPPDATA%\ShortReader\image-browser` (macOS/Linux
`~/.shortreader/image-browser`).

**When Flow or Grok change their page**, update the driver strings in
`core.ts`. They find elements by label/text, not class names. Two lessons
already learned: Flow's "New project" is a fixed-position button (so
`offsetParent` is `null`) with text `add⏎New project`; and never write `\n` in
a comment inside a driver string — it becomes a real line break and breaks the
whole script. `__tests__/services/imagegen-core.test.ts` checks every driver
parses.

### 3.4 Edge TTS (read-aloud voices)

| File | Note |
| --- | --- |
| `libs/edgeTTS.ts` | Microsoft Edge read-aloud voices (WebSocket on desktop; via `app/api/tts/edge/route.ts` on the web). |
| `libs/edgeTTSToken.ts` | The **v2 `Sec-MS-GEC` token** Microsoft has required since October 2026 (the v1 token gets HTTP 403). Ported from [rany2/edge-tts](https://github.com/rany2/edge-tts) `drm.py`. Sent with `Sec-MS-GEC-Version: 2-143.0.3650.75`. If Edge voices fail with 403/500 again, compare these with edge-tts's current `constants.py` and `drm.py`. |

### 3.5 Branding / identity

| Where | Value |
| --- | --- |
| `src-tauri/shortreader.conf.json` | Desktop: `productName: ShortReader`, `identifier: com.shortreader.app` (installs beside Readest/Readster, separate data) |
| `src-tauri/shortreader.android.conf.json` + `gen/android/app/build.gradle.kts` | Android: name ShortReader, `applicationId com.shortreader.app`. The Tauri identifier stays `com.bilingify.readest` on Android because `MainActivity.kt` lives in that Kotlin package. |
| `src-tauri/tauri.conf.json` | Upstream config; updater endpoint points at this repo's releases |
| Still upstream-named (cosmetic) | Rust crate `Readest`, binary `readest.exe`, npm package `@readest/readest-app`, web page title "Readest — …", Xcode project `Readest` |

---

## 4. Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22.18+ (CI uses 24) | everything |
| pnpm | 11.1.1 (`corepack enable` picks it from `package.json`) | everything |
| Rust | stable (rustup) | desktop/mobile builds only |
| Edge or Chrome | any current | making pictures |
| **Windows** desktop build | Visual Studio Build Tools with "Desktop development with C++"; WebView2 (built into Windows 10/11) | |
| **macOS** desktop build | Xcode Command Line Tools (`xcode-select --install`); targets `rustup target add aarch64-apple-darwin x86_64-apple-darwin` for universal | |
| **Linux** desktop build | the usual Tauri v2 packages (webkit2gtk-4.1, libsoup-3, …) — see Tauri's prerequisites page | |

Disk: a desktop release build uses ~10–15 GB under `target/`.

---

## 5. First-time setup

```bash
git clone https://github.com/plaethos99/shortreader.git
cd shortreader
pnpm install
pnpm --filter @readest/readest-app setup-vendors     # pdf.js, simplecc, jieba → public/vendor
cd apps/readest-app
cp .env.web.example .env.web
cp .env.tauri.example .env.tauri
```

The env files hold **no AI keys** — readers enter keys in the app.
`NEXT_PUBLIC_SELF_HOSTED=true` (already in the examples) unlocks the premium
features without a Readest account. `setup-vendors` is not run by `pnpm build`;
run it once per fresh checkout (CI does it in the workflow).

---

## 6. Running it

All commands from `apps/readest-app` unless noted.

### Web app (fastest loop)

```bash
pnpm dev-web            # http://localhost:3000
```

Pictures work here too: the web app's server opens Flow/Imagine in a browser
window **on the same computer**.

### Desktop app (development)

```bash
pnpm tauri dev --config src-tauri/shortreader.conf.json
```

First run compiles the Rust side (10–30 min); later runs are incremental. It
starts `pnpm dev` (port 3000, `.env.tauri`) and opens the app window.
Stop any `dev-web` server first — both use port 3000 and `.next`.

### Image bridge (phones / MCP)

```bash
node tools/image-bridge/bridge.mjs          # from the repo root; port 7531
node tools/image-bridge/bridge.mjs --mcp    # MCP over stdio
```

For a phone: `SHORTREADER_BRIDGE_HOST=0.0.0.0 SHORTREADER_BRIDGE_TOKEN=<secret>`,
then enter `http://<computer-ip>:7531` and the token in the phone's AI Keys.

### Using it

1. Library menu (☰) → **AI Keys** → choose a service, paste a key, **Load
   models**, pick one, **Test**.
2. Pictures: pick Google Flow or Grok Imagine. Ask for a picture (AI Insights →
   Mind map / Visuals / Comic, or "Illustrate this" on a feed card). The site
   opens in its own window; sign in once; the picture is made by itself.

### Tests and checks

```bash
node_modules/.bin/dotenv -e .env -- node_modules/.bin/vitest run <paths>   # run once
pnpm test                       # watch mode
node_modules/.bin/tsc --noEmit  # typecheck
pnpm lint                       # tsc + biome lint
pnpm test:rust                  # Rust unit tests
```

ShortReader's own tests: `__tests__/services/llm.test.ts`,
`imagegen-core.test.ts`, `image-bridge.test.ts`, `lumina-ai.test.ts`,
`scrollfeed-*.test.ts`, `__tests__/utils/mathText.test.ts`,
`__tests__/libs/edge-tts-token.test.ts`.

**Known pre-existing failures** (inherited, not regressions): some Edge-TTS
tests whose mocks point at a fake `api.test` host (`edgeTTS-audio-data`,
`edgeTTS-word-boundaries`, `wordPronouncer`), the zip/archive import group
(`document.test.ts`, `comic-wide-pages`, `series-metadata`, `novel-import`,
`yomitan/importer`, …), and `android-auto-declarations`. Many files also log a
Node "localStorage is not available" warning — harmless.

**Formatting gotcha (Windows):** `biome format --write` on whole folders
rewrites CRLF→LF in hundreds of files. Git then lists them as modified though
the content is identical. Format only the files you changed, or run
`git update-index --refresh` before reviewing `git status`.

---

## 7. Building locally

### Web

```bash
pnpm build-web && pnpm start-web
```

### Windows (on Windows)

```bash
# installer → ../../target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/shortreader.conf.json

# portable single exe (keeps its data beside the exe)
echo "NEXT_PUBLIC_PORTABLE_APP=true" >> .env.tauri
pnpm tauri build --target x86_64-pc-windows-msvc --no-bundle --config src-tauri/shortreader.conf.json
#   → ../../target/x86_64-pc-windows-msvc/release/readest.exe
# remove that line from .env.tauri afterwards
```

### macOS (on a Mac)

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin --bundles dmg \
  --config src-tauri/shortreader.conf.json \
  --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
#   → ../../target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

`signingIdentity: "-"` = ad-hoc signing (Apple Silicon refuses unsigned
binaries). Not notarized: first open of a downloaded copy needs
`xattr -cr /Applications/ShortReader.app`.

### Android

Needs the Android SDK, NDK 28.2.13676358, Java 17 and `rustup target add
aarch64-linux-android`. The Android project is generated, then the customised
files kept in git are restored over it (exactly what CI does):

```bash
cp src-tauri/shortreader.android.conf.json src-tauri/tauri.android.conf.json
rm -rf src-tauri/gen/android
pnpm tauri android init --ci
git checkout -- src-tauri/gen/android
```

Signing: put `keystore.properties` (`keyAlias=`, `password=`,
`storeFile=<path to the keystore>`) in `src-tauri/gen/android/`, then
`pnpm build-android` (arm64 APK). **Never commit the keystore or
`keystore.properties`.** More in `apps/readest-app/docs/DEPLOYMENT.md`.

---

## 8. Releasing on GitHub

Releases are built by **`.github/workflows/shortreader-release.yml`** on
GitHub's runners — no local build needed, no secrets needed (no AI keys are
built in).

### 8.1 Cut a release

```bash
git checkout main && git pull
git tag shortreader-v0.1.2          # any tag starting with shortreader-v
git push origin shortreader-v0.1.2
```

Or: GitHub → **Actions → Release ShortReader → Run workflow**, enter the tag.

### 8.2 What the workflow does

1. `create-release` — creates the GitHub Release for the tag (as a
   **pre-release**) if it doesn't exist.
2. `build` matrix, in parallel (~30–60 min):
   - **windows** (`windows-latest`) → `ShortReader_<tag>_x64-setup.exe`
     (NSIS installer) and `ShortReader_<tag>_x64-portable.exe`.
   - **macos** (`macos-latest`) → `ShortReader_<tag>_universal.dmg`
     (Intel + Apple Silicon, ad-hoc signed).
   - **ios** → unsigned `.ipa` — **currently fails** (see 8.4).
3. `android` job (`ubuntu-latest`, ~20 min warm) → `ShortReader_<tag>_arm64.apk`,
   signed with the ShortReader key from repository secrets (8.5).
4. Each job uploads its files to the release (`gh release upload --clobber`).

Watch it under the repo's **Actions** tab; files appear under **Releases**.

### 8.3 Versions

- The tag name is only the release label. The **app's own version** (shown in
  the app and in installer metadata) comes from `apps/readest-app/package.json`
  `"version"` (still upstream's `0.12.8`). Bump it before tagging if you want
  the app to report the new version.
- To publish as a normal (not pre-) release: edit the release on GitHub and
  untick "Set as a pre-release", or change `--prerelease` in the workflow.
- To rebuild the same tag: delete the release and the tag on GitHub
  (`git push origin :refs/tags/<tag>`), re-tag, push. Re-running the failed
  jobs from the Actions page also works; uploads use `--clobber`.

### 8.4 Known release issues

- **iOS job fails**: `xcodebuild` wants a provisioning profile for
  `com.shortreader.app` ("No Accounts… No profiles…"). The run therefore shows
  as *failed* even though the Windows and macOS files were uploaded. Fix by
  either removing the `ios` entry from the matrix, or adding Apple signing
  (team, certificate, profile as secrets).
- **Unsigned apps**: Windows SmartScreen will warn ("Unknown publisher"); macOS
  Gatekeeper needs the `xattr` command above. Proper fixes: a Windows
  code-signing certificate; an Apple Developer ID + notarization.
- **Auto-update** is off (`createUpdaterArtifacts: false`); the updater
  endpoint in `tauri.conf.json` points at this repo but no `latest.json` is
  published.

### 8.5 Android signing key

Android only installs an update signed with the same key as the installed app.
The ShortReader key (PKCS12, alias `shortreader`, RSA 4096, created 2026-10-19)
is stored as repository secrets **`ANDROID_KEY_BASE64`** (the keystore,
base64), **`ANDROID_KEY_ALIAS`** and **`ANDROID_KEY_PASSWORD`**. The owner holds
the private backup; it is not in this repository. Signer SHA-256:
`D0:86:79:D3:59:43:2C:8B:D4:F5:D0:6F:94:9C:46:44:57:48:D3:CF:AA:70:0F:67:44:37:87:41:DF:58:36:2E`.
Check an APK with `apksigner verify --print-certs <apk>`. If the secrets are
missing, the job signs with a key made for that build (installs, but can't
update an earlier install). Never replace the key unless it is lost or leaked.

### 8.6 Inherited upstream workflows

The repo still contains Readest's CI, and all of it is active. On pushes to
`main` these run and fail or do nothing useful for ShortReader: **Deploy to
vercel on merge** (fails), **PR checks** (fails), **Build with Nix** (fails),
**Publish Docker image** (pushes a container to `ghcr.io/plaethos99/readest`).
Also inherited: **Nightly Readest** (daily schedule), **Release Readest**
(runs when a release is published), **Upload Release Assets to R2**, **Try
Linux AppImage**, **Android E2E (CDP)**, the Nix updaters, Scorecard, CodeQL.
Recommended: disable all but **Release ShortReader** (and CodeQL if you like
the security scan):

```bash
for w in "Deploy to vercel on merge" "PR checks" "Build with Nix" "Publish Docker image" \
         "Nightly Readest" "Release Readest" "Upload Release Assets to R2" "Try Linux AppImage" \
         "Android E2E (CDP)" "Check Nix Dependency Hashes" "Update Nix Dependencies"; do
  gh workflow disable "$w" --repo plaethos99/shortreader
done
```

…or delete the files you don't want, keeping `shortreader-release.yml`.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "AI is not set up" / feed asks for a key | Settings → AI Keys: key + model, then **Test**. |
| A model errors on long chapters | It may cap replies below 32k tokens; the client retries without the cap, but some providers still refuse — pick a model with a larger output limit. |
| Scanned books show no text | The chosen model must read images (vision). |
| Picture waits forever after sign-in | Flow/Grok changed their page; update the driver in `services/imagegen/core.ts` (§3.3). |
| "Pictures are made in Microsoft Edge or Google Chrome…" | Install Edge or Chrome (or set `SHORTREADER_BROWSER` for the bridge/web route). |
| Flow says CAPTCHA | Answer it in the Flow window; the engine never bypasses one. |
| Edge voices fail (403/500) | Microsoft changed the token again — see §3.4. |
| `Cannot find module '@pdfjs/pdf.min.mjs'` / simplecc | Run `pnpm --filter @readest/readest-app setup-vendors`. |
| Turbopack: "Symlink … points out of the filesystem root" | `node_modules` is a link to another checkout; run a real `pnpm install` in this one. |
| Port 3000 busy / odd `.next` errors | Stop the other dev server; delete `apps/readest-app/.next/dev`. |

---

## 10. Licences and credits

- ShortReader is AGPL-3.0, as Readest is. Keep the source public for anything
  you distribute.
- `libs/edgeTTSToken.ts` ports the token algorithm from rany2/edge-tts.
- The Flow/Grok page drivers come from the BookShorts project.
- Use Google Flow and Grok Imagine within their terms, with your own accounts.
