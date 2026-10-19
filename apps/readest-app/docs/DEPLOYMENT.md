# Deployment

How to configure keys, build Readster for Android and the web, and sign and
ship a release. Readster runs without any Readest cloud account: no sign-in is
required and no Readest backend is contacted.

- [1. Prerequisites](#1-prerequisites)
- [2. Where the keys go](#2-where-the-keys-go)
- [3. First-time checkout](#3-first-time-checkout)
- [4. Android release build](#4-android-release-build)
- [5. Signing](#5-signing)
- [6. Regenerating gen/android](#6-regenerating-genandroid)
- [7. Web deployment](#7-web-deployment)
- [8. Desktop builds](#8-desktop-builds)
- [9. Release checklist](#9-release-checklist)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ | 22 LTS recommended |
| pnpm | 11.1.1 | pinned by `packageManager` in the root `package.json`; `corepack enable` picks it up |
| Rust | stable, 1.90+ | `rustup` |
| JDK | 21 | Android Studio's bundled JBR works (`<studio>/jbr`) |
| Android SDK | platform 36, build-tools 36 | |
| Android NDK | 27.3.13750724 | must match what Gradle resolves |

Rust Android targets (only the ones you build for):

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Environment variables the Android build needs:

| Variable | Example (Windows) | Example (macOS/Linux) |
| --- | --- | --- |
| `ANDROID_HOME` | `D:\androidsdk` | `~/Library/Android/sdk` |
| `NDK_HOME` | `D:\androidsdk\ndk\27.3.13750724` | `$ANDROID_HOME/ndk/27.3.13750724` |
| `JAVA_HOME` | `D:\android\jbr` | `/Applications/Android Studio.app/Contents/jbr/Contents/Home` |

`pnpm build-android` fails early and names whichever one is missing.

---

## 2. Where the keys go

### The env files

| File | Used by | Tracked by git? |
| --- | --- | --- |
| `apps/readest-app/.env.web` | `pnpm dev-web`, `pnpm build-web`, Cloudflare deploy | **No** (git-ignored) |
| `apps/readest-app/.env.tauri` | desktop and mobile builds, including the APK | **No** (git-ignored) |
| `apps/readest-app/.env` | pdf.js asset paths for tests and tooling | Yes — never put secrets here |
| `apps/readest-app/.env.local` | optional server-side secrets (Supabase admin, DeepL, R2) | No |

Create the two you need from their examples:

```bash
cd apps/readest-app
cp .env.web.example .env.web
cp .env.tauri.example .env.tauri
```

### AI: no keys in the build

ShortReader ships with no AI keys. Each reader opens **Settings → AI Keys** (or
the key button in AI Insights), picks a service — OpenRouter, OpenAI, Anthropic,
Gemini, xAI, DeepSeek, Groq, Mistral, Together, Ollama or any OpenAI-compatible
endpoint — pastes their own key and chooses any model the key can use. Keys are
kept on that device only and sent only to the chosen service.

Pictures (mind maps, visuals, comics, feed pictures) come from **Google Flow**
or **Grok Imagine**, the reader's choice, made in a real Edge or Chrome window
where they sign in; the app opens it and waits for the sign-in by itself. Phones
use the image bridge on a computer; see
[`tools/image-bridge/README.md`](../../../tools/image-bridge/README.md).

| Variable | What it does | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SELF_HOSTED` | `true` unlocks premium features (TTS downloads, offline audiobooks, third-party cloud sync) with no account | `true` |
| `NEXT_PUBLIC_APP_PLATFORM` | `web` in `.env.web`, `tauri` in `.env.tauri` | already set in the examples |

`setup-vendors` is **required** and is not run by `pnpm build`. The bundled
foliate-js expects pdf.js 6.2.108; a stale or missing `public/vendor/pdfjs`
breaks PDF rendering with no clear error. Re-run it after changing
`packages/foliate-js` or its dependencies.

Verify the checkout:

```bash
pnpm lint      # tsc --noEmit + biome
pnpm test      # vitest
```

---

## 4. Android release build

```bash
cd apps/readest-app
pnpm build-android
```

That wraps [`scripts/build-android-release.mjs`](../scripts/build-android-release.mjs),
which loads `.env.tauri`, checks the toolchain variables and runs:

```
tauri android build -t aarch64 --apk --split-per-abi
```

| Want | Command |
| --- | --- |
| arm64 APK (default) | `pnpm build-android` |
| AAB for Google Play | `pnpm build-android --aab` |
| APK and AAB | `pnpm build-android --apk --aab` |
| Several architectures | `pnpm build-android -t aarch64 -t armv7` |
| A different env file | `pnpm build-android --env-file .env.tauri.local` |

Output:

```
src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

An AAB build writes to `outputs/bundle/<flavor>Release/` alongside it — a
universal build gives `bundle/universalRelease/app-universal-release.aab`. The
CLI prints the exact paths at the end of the build.

Install it:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

### Why `--split-per-abi` matters

Native code dominates the download, and the universal APK carries one copy per
architecture:

| Build | Size |
| --- | --- |
| Debug, universal | ~506 MB |
| Release, universal (4 ABIs) | ~316 MB |
| **Release, arm64 only** | **~83 MB** |

Every 64-bit Android phone since 2019 runs arm64-v8a. Build `armv7` as well
only for pre-2019 32-bit devices, or upload the AAB and let Play split it.

> **Do not use `pnpm dev-android` for releases.** It builds a universal
> debug-featured APK, and its `dotenv -e .env.tauri -- tauri ...` wrapper
> silently swallows the `-t` flag (see
> [Troubleshooting](#flags-like--t-or---split-per-abi-are-ignored)).

### First build after a clean checkout

`gen/android` is not in git (see [section 6](#6-regenerating-genandroid)). Without
it, `tauri android init` must be run first and the Readster customizations
re-applied, or the build will produce an app called "Readest" with the upstream
application id.

### Build time and disk

A cold release build compiles the Rust workspace twice (once for the library,
once through Gradle) and takes **20–40 minutes**. Each Android target's cache
under `target/` is **12–15 GB**; keep at least 20 GB free.

---

## 5. Signing

Release builds are signed by Gradle when
`src-tauri/gen/android/keystore.properties` exists. Without it the APK is
unsigned and Android refuses to install it.

Create a keystore once and keep it safe — **an app can only be updated by the
same key it was first signed with**:

```bash
keytool -genkey -v \
  -keystore src-tauri/gen/android/release.keystore \
  -alias readster -keyalg RSA -keysize 2048 -validity 10000
```

Then write `src-tauri/gen/android/keystore.properties`:

```ini
keyAlias=readster
password=<the password you chose>
storeFile=release.keystore
```

`storeFile` is relative to `src-tauri/gen/android/`. Both files are outside git
on purpose: back them up somewhere private (a password manager or an encrypted
archive). Losing them means you cannot ship an update to an installed app.

Check what you built:

```bash
$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging app-arm64-release.apk | head -5
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs app-arm64-release.apk
```

Expected: `package: name='com.readster.app'`, `application-label:'Readster'`,
`native-code: 'arm64-v8a'`, and one signer certificate.

### Google Play

Upload the **AAB**, not the APK. The repo has
[`scripts/release-google-play.sh`](../scripts/release-google-play.sh), driven by
`.env.google-play.local` (service-account JSON and track):

```bash
pnpm release-google-play
```

---

## 6. Regenerating gen/android

`src-tauri/gen/android/` is generated and **untracked** (it holds your keystore).
Tauri recreates it with:

```bash
pnpm tauri android init
```

That produces an upstream Readest project, so re-apply these five Readster
changes afterwards. They are what make the app install as Readster alongside
Readest:

**1. Application id** — `app/build.gradle.kts`, in `defaultConfig`:

```kotlin
// Independent app id so this installs alongside readest instead of being
// treated as an update to it. Distinct from `namespace`
// (com.bilingify.readest), which must keep matching the Tauri identifier so
// the generated Kotlin/WebView package still resolves.
applicationId = "com.readster.app"
```

**2. App name** — `app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">Readster</string>
    <string name="main_activity_title">Readster</string>
</resources>
```

**3. Launcher icon** — `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`;
the generated file points `background` at `@color/ic_launcher_background`,
which does not exist here:

```xml
<background android:drawable="@drawable/ic_launcher_background"/>
```

**4. Signing** — copy in `keystore.properties` and `release.keystore`
([section 5](#5-signing)).

**5. Windows only** — `buildSrc/.../BuildTask.kt` resolves `node` from `PATH`,
which Gradle does not inherit on Windows. Set the absolute path:

```kotlin
val executable = """C:\Program Files\nodejs\node""";
```

The version name and code come from `apps/readest-app/package.json` via the
autogenerated `app/tauri.properties` — do not edit that file. Version `0.12.8`
becomes `versionCode 12008`.

---

## 7. Web deployment

Local:

```bash
cd apps/readest-app
pnpm dev-web            # http://localhost:3000
pnpm build-web          # production build
pnpm start-web
```

Cloudflare Workers (OpenNext), which is how readest.com is deployed:

```bash
pnpm preview            # local Workers runtime on :3001
pnpm deploy             # build + wrangler deploy
```

`pnpm deploy` needs `wrangler` authenticated (`wrangler login`) and
`wrangler.toml` filled in — `pnpm config-wrangler` substitutes
`TRANSLATIONS_KV_ID`. Set the same `NEXT_PUBLIC_*` keys as Workers
secrets/vars, since `.env.web` is not uploaded.

Any static or Node host works too: `pnpm build-web` then serve with
`pnpm start-web`. Remember that a web deployment exposes the API keys to every
visitor — for anything public, proxy the AI calls through a server route with a
server-side key instead.

Docker: the repo root has a `Dockerfile` and `docker/.env.example` for a
self-hosted web deployment.

---

## 8. Desktop builds

```bash
pnpm build-win-x64        # NSIS installer
pnpm build-win-arm64
pnpm build-linux-x64      # AppImage
pnpm build-macos-universial   # DMG
```

These read `.env.tauri.local`, so copy `.env.tauri` to `.env.tauri.local` (or
create a signing-specific one). macOS notarization and the App Store variants
need Apple credentials in `.env.apple-*.local`.

---

## 9. Release checklist

1. `pnpm lint` and `pnpm test` pass.
2. `pnpm setup-vendors` has been run in this checkout.
3. Bump `version` in `apps/readest-app/package.json` (drives `versionCode`).
4. Keys present in `.env.tauri`, with only a small balance on the DeepSeek account.
5. `pnpm build-android` (add `--aab` for Play).
6. Verify with `aapt2 dump badging` and `apksigner verify`.
7. Install on a device and check: a book opens, curated feed generates, AI
   Insights makes an image, read-aloud plays.
8. Keep `release.keystore` and `keystore.properties` backed up.
9. Never publish an APK built with keys you are not willing to expose.

---

## 10. Troubleshooting

### Flags like `-t` or `--split-per-abi` are ignored

`dotenv -e .env.tauri -- tauri android build -t aarch64` does **not** forward
those flags: `dotenv-cli` parses them itself. The build then compiles all four
ABIs into a universal APK. Confirm it by running the same wrapper with
`--help` — dotenv's help appears instead of Tauri's. Use `pnpm build-android`,
which loads the env file in-process and keeps the flags.

### `error: failed to build archive ... There is not enough space on the disk. (os error 112)`

The disk filled up mid-link. Each Android target cache is 12–15 GB. Safe to
delete (all regenerated on the next build):

```
target/<abi>-linux-android/    # caches for architectures you don't build
target/debug/  target/release/ # desktop build caches
apps/readest-app/src-tauri/gen/android/app/build/outputs/*.apk|*.aab
apps/readest-app/.next/        # Next.js cache (stop the dev server first)
```

### The APK is ~500 MB

That is a debug build: unstripped symbols for four architectures. Use
`pnpm build-android`. Release settings (`strip`, `lto`, `opt-level = "s"`) live
in the root `Cargo.toml` under `[profile.release]`.

### "Add your AI key and choose a model"

Open **Settings → AI Keys**, pick the service, paste the key, press **Load the
models for this key**, pick one and press **Test**. Scanned books need a model
that reads images.

### AI text is slow or costs more than expected

Keep **Answer without thinking** on. Reasoning models otherwise think before
every answer: for DeepSeek's flash model that was about 7k hidden tokens per
chapter analysis, 64 s and roughly 4× the cost.

### Pictures: a browser window opens

That is by design. Google Flow and Grok Imagine have no API for this, so the
desktop app (and the web app run on your own computer) opens the site in its
own Edge or Chrome window. Sign in there once; the picture then starts by
itself, and later pictures need no sign-in. Edge or Chrome must be installed.
On a phone, pictures go through the image bridge on a computer:
see `tools/image-bridge/README.md`.

### Gradle cannot find the SDK or NDK

`ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME` must be set in the shell that runs
the build; `pnpm build-android` names the missing one. The NDK version must be
the one Gradle resolves (27.3.13750724).

### PDFs render blank or throw in the reader

`public/vendor/pdfjs` is missing or stale. Run `pnpm setup-vendors`.
