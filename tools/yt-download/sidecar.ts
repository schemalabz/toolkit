#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import { createSidecar } from '../shared/sidecar-harness.js';
import { runBackup } from './core.js';
import type { ProgressEvent } from './types.js';

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

async function downloadBinary(
  binDir: string,
  name: string,
  url: string,
  emit: (event: Record<string, unknown>) => void,
): Promise<string> {
  const destPath = path.join(binDir, name);

  if (fs.existsSync(destPath)) return destPath;

  fs.mkdirSync(binDir, { recursive: true });

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

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(destPath, buffer);
  fs.chmodSync(destPath, 0o755);

  emit({ type: 'status', message: `${name} downloaded successfully` });
  return destPath;
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

    const ffmpegBinary = getFfmpegBinaryName();
    const ffmpegUrl = `https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1/${ffmpegBinary}`;
    const ffmpegPath = await downloadBinary(binDir, 'ffmpeg', ffmpegUrl, emit);

    emit({ type: 'deps-ready', ytdlpPath, ffmpegPath });
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
    });
  },
});
