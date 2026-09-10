#!/usr/bin/env bun

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createSidecar } from '../shared/sidecar-harness.js';
import { runBackup } from './core.js';
import type { ProgressEvent } from './types.js';

/** Strip macOS extended attributes that block execution of downloaded binaries. */
function clearMacosAttributes(filePath: string) {
  if (process.platform !== 'darwin') return;
  try {
    execSync(`xattr -d com.apple.provenance "${filePath}" 2>/dev/null`);
  } catch { /* attribute may not exist */ }
  try {
    execSync(`xattr -d com.apple.quarantine "${filePath}" 2>/dev/null`);
  } catch { /* attribute may not exist */ }
}

function getYtdlpBinaryName(): string {
  const platform = process.platform;
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') return 'yt-dlp_linux';
  throw new Error(`Unsupported platform: ${platform}`);
}

function getFfmpegBinaryName(): string {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (platform === 'darwin') return `ffmpeg-darwin-${arch}`;
  if (platform === 'linux') return `ffmpeg-linux-${arch}`;
  throw new Error(`Unsupported platform: ${platform}`);
}

/** Deno release assets are Rust target triples, and always zipped. */
function getDenoAssetName(): string {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (platform === 'darwin') return `deno-${arch}-apple-darwin.zip`;
  if (platform === 'linux') return `deno-${arch}-unknown-linux-gnu.zip`;
  throw new Error(`Unsupported platform: ${platform}`);
}

async function fetchToBuffer(
  name: string,
  url: string,
  emit: (event: Record<string, unknown>) => void,
): Promise<Buffer> {
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (contentLength > 0) {
      const percent = Math.round((downloaded / contentLength) * 100);
      emit({
        type: 'download-progress',
        dep: name,
        percent,
        downloaded: `${(downloaded / 1024 / 1024).toFixed(1)}MB`,
        total: `${(contentLength / 1024 / 1024).toFixed(1)}MB`,
      });
    }
  }

  return Buffer.concat(chunks);
}

/** Download a bare executable. */
async function downloadBinary(
  binDir: string,
  name: string,
  url: string,
  emit: (event: Record<string, unknown>) => void,
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
 * There is no bundled zip library, so this shells out. `unzip` is the usual
 * answer but is not guaranteed to be on PATH (it is absent from our own Nix dev
 * shell); macOS always ships `ditto`. Try each and report both failures rather
 * than dying on a bare "command not found".
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
async function downloadZippedBinary(
  binDir: string,
  name: string,
  url: string,
  emit: (event: Record<string, unknown>) => void,
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

/**
 * Keep yt-dlp current via its own self-update.
 *
 * Without this the binary is frozen at whatever version was installed the first
 * time the app ran — `downloadBinary` returns early once the file exists. YouTube
 * breaks yt-dlp every few weeks, so a months-old binary fails on videos a current
 * one handles. Best-effort: a failed check (offline, locked file) must not block
 * a download that would otherwise work.
 */
function refreshYtdlp(ytdlpPath: string, emit: (event: Record<string, unknown>) => void): void {
  emit({ type: 'status', message: 'Checking for yt-dlp updates...' });

  const result = spawnSync(ytdlpPath, ['--update'], {
    encoding: 'utf-8',
    timeout: 120_000,
  });

  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit code ${result.status}`;
    emit({ type: 'status', message: `Could not check for yt-dlp updates (${reason}) — continuing` });
    return;
  }

  // A self-update rewrites the binary, so macOS re-tags it.
  clearMacosAttributes(ytdlpPath);
  emit({ type: 'status', message: (result.stdout || '').trim().split('\n').pop() || 'yt-dlp is up to date' });
}

createSidecar({
  'ensure-deps': async (input, emit) => {
    const dataDir = input.dataDir as string;
    if (!dataDir) {
      emit({ type: 'error', message: 'Missing dataDir for ensure-deps action' });
      process.exit(1);
    }

    const binDir = path.join(dataDir, 'bin');

    const ytdlpBinary = getYtdlpBinaryName();
    const ytdlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpBinary}`;
    const ytdlpPath = await downloadBinary(binDir, 'yt-dlp', ytdlpUrl, emit);
    refreshYtdlp(ytdlpPath, emit);

    const ffmpegBinary = getFfmpegBinaryName();
    const ffmpegUrl = `https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1/${ffmpegBinary}`;
    const ffmpegPath = await downloadBinary(binDir, 'ffmpeg', ffmpegUrl, emit);

    // yt-dlp's JavaScript runtime — without it YouTube extraction falls back to
    // deprecated clients and 403s. See buildYtdlpArgs in core.ts.
    const denoAsset = getDenoAssetName();
    const denoUrl = `https://github.com/denoland/deno/releases/latest/download/${denoAsset}`;
    const denoPath = await downloadZippedBinary(binDir, 'deno', denoUrl, emit);

    emit({ type: 'deps-ready', ytdlpPath, ffmpegPath, denoPath });
  },

  'run': async (input, emit) => {
    const config = {
      youtubeUrl: input.youtubeUrl as string,
      outputDir: input.outputDir as string,
      localOnly: input.localOnly as boolean,
      serverUrl: (input.serverUrl as string) || '',
      apiKey: (input.apiKey as string) || '',
    };

    if (!config.youtubeUrl) {
      emit({ type: 'error', message: 'Missing youtubeUrl' });
      process.exit(1);
    }
    if (!config.outputDir) {
      emit({ type: 'error', message: 'Missing outputDir' });
      process.exit(1);
    }

    await runBackup(config, (event) => emit(event as unknown as Record<string, unknown>), {
      ytdlpPath: input.ytdlpPath as string | undefined,
      ffmpegPath: input.ffmpegPath as string | undefined,
      denoPath: input.denoPath as string | undefined,
    });
  },
});
