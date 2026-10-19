#!/usr/bin/env node
/**
 * Release APK/AAB build for Android.
 *
 * Exists because the `dotenv -e .env.tauri -- tauri android build -t aarch64`
 * pattern used elsewhere in package.json does NOT work: dotenv-cli parses the
 * flags that follow the command instead of forwarding them, so `-t` and
 * `--split-per-abi` never reach the Tauri CLI. The build then compiles all four
 * ABIs into one universal APK (~316MB instead of ~83MB). This script loads the
 * env file itself and execs the CLI with the flags intact.
 *
 * Usage (from apps/readest-app):
 *   pnpm build-android            # arm64 APK, split per ABI
 *   pnpm build-android --aab      # ... and/or an AAB for Play
 *   pnpm build-android -t aarch64 -t armv7
 *   pnpm build-android --env-file .env.tauri.local
 *
 * Anything passed through is forwarded to `tauri android build`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const envFileIndex = argv.indexOf('--env-file');
const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : '.env.tauri';
const passthrough = envFileIndex >= 0 ? argv.filter((_, i) => i < envFileIndex || i > envFileIndex + 1) : argv;

/** KEY=value lines; `export ` prefixes, #comments and blank lines ignored. */
const loadEnvFile = (file) => {
  const path = resolve(appDir, file);
  if (!existsSync(path)) {
    console.error(`Missing ${file}. Copy ${file}.example and fill in your keys.`);
    process.exit(1);
  }
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return path;
};

// The Android toolchain is found through these; Gradle and the NDK fail with
// unhelpful errors when they are unset, so say which one is missing.
const requireToolchain = () => {
  const sdk = process.env['ANDROID_HOME'] || process.env['ANDROID_SDK_ROOT'];
  const missing = [];
  if (!sdk) missing.push('ANDROID_HOME (or ANDROID_SDK_ROOT)');
  if (!process.env['NDK_HOME']) missing.push('NDK_HOME');
  if (!process.env['JAVA_HOME']) missing.push('JAVA_HOME');
  if (missing.length) {
    console.error(`Set ${missing.join(', ')} — see docs/DEPLOYMENT.md (Android prerequisites).`);
    process.exit(1);
  }
  if (!existsSync(sdk)) {
    console.error(`ANDROID_HOME points at a folder that does not exist: ${sdk}`);
    process.exit(1);
  }
  process.env['ANDROID_SDK_ROOT'] ??= sdk;
  process.env['ANDROID_HOME'] ??= sdk;
};

const keystoreWarning = () => {
  if (!existsSync(join(appDir, 'src-tauri/gen/android/keystore.properties'))) {
    console.warn(
      'No src-tauri/gen/android/keystore.properties: the APK will be unsigned and will not install.',
    );
  }
};

const envPath = loadEnvFile(envFile);
requireToolchain();
keystoreWarning();

// Default to one arm64 APK per ABI; both are overridable from the command line.
const args = ['android', 'build'];
if (!passthrough.includes('-t') && !passthrough.includes('--target')) args.push('-t', 'aarch64');
if (!passthrough.includes('--apk') && !passthrough.includes('--aab')) args.push('--apk');
if (!passthrough.includes('--split-per-abi')) args.push('--split-per-abi');
args.push(...passthrough);

console.log(`env: ${envPath}`);
console.log(`tauri ${args.join(' ')}`);

const tauri = join(appDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const { status } = spawnSync(tauri, args, { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(status ?? 1);
