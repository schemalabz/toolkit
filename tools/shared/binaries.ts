/**
 * Shared provisioning for the external binaries our tools shell out to.
 *
 * Tools download what they need on first use rather than depending on the host having it.
 * This lives in `shared` because more than one tool needs the same binary — ffmpeg is used
 * by both yt-download and video-edit — and they must agree on where it goes, or each ships
 * its own 80MB copy.
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type EmitFn = (event: Record<string, unknown>) => void;

/** Pinned so an upstream re-tag cannot silently change the ffmpeg our tools run. */
const FFMPEG_RELEASE = 'https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1';

/** Strip macOS extended attributes that block execution of downloaded binaries. */
export function clearMacosAttributes(filePath: string): void {
  if (process.platform !== 'darwin') return;
  try {
    execSync(`xattr -d com.apple.provenance "${filePath}" 2>/dev/null`);
  } catch { /* attribute may not exist */ }
  try {
    execSync(`xattr -d com.apple.quarantine "${filePath}" 2>/dev/null`);
  } catch { /* attribute may not exist */ }
}

/**
 * Where downloaded binaries live.
 *
 * The desktop app passes its own data directory. The CLI has none, so it falls back to a
 * per-user cache — deliberately the same location for every tool, so a binary downloaded by
 * one is found by the next.
 */
export function resolveBinDir(dataDir?: string): string {
  if (dataDir) return path.join(dataDir, 'bin');

  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');

  return path.join(base, 'schemalabs-toolkit', 'bin');
}

export function ffmpegAssetName(tool: 'ffmpeg' | 'ffprobe'): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `${tool}-darwin-${arch}`;
  if (process.platform === 'linux') return `${tool}-linux-${arch}`;
  throw new Error(`Unsupported platform: ${process.platform}`);
}

export function ytdlpAssetName(): string {
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') return 'yt-dlp_linux';
  throw new Error(`Unsupported platform: ${process.platform}`);
}

/** Deno release assets are Rust target triples, and always zipped. */
export function denoAssetName(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `deno-${arch}-apple-darwin.zip`;
  if (process.platform === 'linux') return `deno-${arch}-unknown-linux-gnu.zip`;
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function fetchToBuffer(name: string, url: string, emit: EmitFn): Promise<Buffer> {
  emit({ type: 'status', message: `Downloading ${name}...` });

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${name}: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  // Emit only when the whole percentage moves. Emitting per chunk produced tens of thousands
  // of events for one 128MB binary, which buried the actual output.
  let lastPercent = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (contentLength > 0) {
      const percent = Math.round((downloaded / contentLength) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        emit({
          type: 'download-progress',
          dep: name,
          percent,
          downloaded: `${(downloaded / 1024 / 1024).toFixed(1)}MB`,
          total: `${(contentLength / 1024 / 1024).toFixed(1)}MB`,
        });
      }
    }
  }

  return Buffer.concat(chunks);
}

/** Download a bare executable, or return the one already downloaded. */
export async function ensureBinary(
  binDir: string,
  name: string,
  url: string,
  emit: EmitFn,
): Promise<string> {
  const destPath = path.join(binDir, name);

  if (fs.existsSync(destPath)) {
    clearMacosAttributes(destPath);
    return destPath;
  }

  fs.mkdirSync(binDir, { recursive: true });

  const buffer = await fetchToBuffer(name, url, emit);
  fs.writeFileSync(destPath, buffer);
  fs.chmodSync(destPath, 0o755);
  clearMacosAttributes(destPath);

  emit({ type: 'status', message: `${name} downloaded successfully` });
  return destPath;
}

/**
 * Extract a zip using whatever the host provides.
 *
 * There is no bundled zip library, so this shells out. `unzip` is the usual answer but is not
 * guaranteed to be on PATH (it is absent from our own Nix dev shell); macOS always ships
 * `ditto`. Try each and report both failures rather than dying on a bare "command not found".
 */
function extractZip(zipPath: string, destDir: string): void {
  const candidates: Array<{ cmd: string; args: string[] }> = [
    // -j flattens any directory structure, -o overwrites a half-extracted retry
    { cmd: 'unzip', args: ['-o', '-q', '-j', zipPath, '-d', destDir] },
    ...(process.platform === 'darwin'
      ? [{ cmd: 'ditto', args: ['-x', '-k', zipPath, destDir] }]
      : []),
  ];

  const failures: string[] = [];

  for (const { cmd, args } of candidates) {
    const result = spawnSync(cmd, args, { encoding: 'utf-8' });
    if (!result.error && result.status === 0) return;
    failures.push(`${cmd}: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
  }

  throw new Error(`Could not extract ${path.basename(zipPath)} — ${failures.join('; ')}`);
}

/** Download an executable that ships inside a zip archive (Deno). */
export async function ensureZippedBinary(
  binDir: string,
  name: string,
  url: string,
  emit: EmitFn,
): Promise<string> {
  const destPath = path.join(binDir, name);

  if (fs.existsSync(destPath)) {
    clearMacosAttributes(destPath);
    return destPath;
  }

  fs.mkdirSync(binDir, { recursive: true });

  const buffer = await fetchToBuffer(name, url, emit);
  const zipPath = path.join(binDir, `${name}.zip`);
  fs.writeFileSync(zipPath, buffer);

  try {
    extractZip(zipPath, binDir);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }

  if (!fs.existsSync(destPath)) {
    throw new Error(`${name} archive did not contain an executable named ${name}`);
  }

  fs.chmodSync(destPath, 0o755);
  clearMacosAttributes(destPath);

  emit({ type: 'status', message: `${name} downloaded successfully` });
  return destPath;
}

/** Whether a command exists and runs on PATH. */
function runnableOnPath(command: string): boolean {
  const result = spawnSync(command, ['-version'], { encoding: 'utf-8', timeout: 10_000 });
  return !result.error && result.status === 0;
}

export interface FfmpegPaths {
  ffmpegPath: string;
  ffprobePath: string;
}

export interface EnsureFfmpegOptions {
  /** The app's data directory. Omit in the CLI to use the shared per-user cache. */
  dataDir?: string;
  emit?: EmitFn;
  /**
   * Download even when ffmpeg is already on PATH. Off by default: a developer in the Nix
   * shell, or anyone with a system ffmpeg, should not wait for 160MB they already have.
   */
  ignorePath?: boolean;
}

/**
 * ffmpeg and ffprobe, ready to run.
 *
 * Prefers whatever is already on PATH, then a previous download, and only then fetches.
 * Both binaries come from the same pinned release so their versions cannot diverge.
 */
export async function ensureFfmpeg(opts: EnsureFfmpegOptions = {}): Promise<FfmpegPaths> {
  const emit = opts.emit ?? (() => {});

  if (!opts.ignorePath && runnableOnPath('ffmpeg') && runnableOnPath('ffprobe')) {
    return { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };
  }

  // Sequential, not parallel: both report progress to the same line, and interleaved
  // percentages from two downloads are unreadable.
  const binDir = resolveBinDir(opts.dataDir);
  const ffmpegPath = await ensureBinary(binDir, 'ffmpeg', `${FFMPEG_RELEASE}/${ffmpegAssetName('ffmpeg')}`, emit);
  const ffprobePath = await ensureBinary(binDir, 'ffprobe', `${FFMPEG_RELEASE}/${ffmpegAssetName('ffprobe')}`, emit);

  return { ffmpegPath, ffprobePath };
}
