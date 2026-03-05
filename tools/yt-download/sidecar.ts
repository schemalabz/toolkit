#!/usr/bin/env bun

/**
 * Sidecar entry point for the yt-download tool in the Tauri desktop app.
 *
 * Accepts input as a base64-encoded JSON argument:
 *   yt-download-sidecar <base64-json>
 *
 * Actions:
 *   - "ensure-deps": { dataDir } — downloads yt-dlp if not present
 *   - "run": { youtubeUrl, outputDir, localOnly, serverUrl, apiKey, ytdlpPath } — runs the download/upload flow
 *
 * Writes NDJSON progress events to stdout.
 */

import fs from 'fs';
import path from 'path';
import { runBackup } from './core.js';
import type { ProgressEvent } from './types.js';

function emit(event: ProgressEvent | Record<string, unknown>) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function getPlatformBinaryName(): string {
  const platform = process.platform;
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') return 'yt-dlp_linux';
  throw new Error(`Unsupported platform: ${platform}`);
}

async function ensureDeps(dataDir: string): Promise<string> {
  const binDir = path.join(dataDir, 'bin');
  const ytdlpPath = path.join(binDir, 'yt-dlp');

  if (fs.existsSync(ytdlpPath)) {
    emit({ type: 'deps-ready', ytdlpPath });
    return ytdlpPath;
  }

  fs.mkdirSync(binDir, { recursive: true });

  const binaryName = getPlatformBinaryName();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;

  emit({ type: 'status', message: `Downloading yt-dlp from ${url}...` });

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp: ${response.status} ${response.statusText}`);
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
        percent,
        downloaded: `${(downloaded / 1024 / 1024).toFixed(1)}MB`,
        total: `${(contentLength / 1024 / 1024).toFixed(1)}MB`,
      });
    }
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(ytdlpPath, buffer);
  fs.chmodSync(ytdlpPath, 0o755);

  emit({ type: 'status', message: 'yt-dlp downloaded successfully' });
  emit({ type: 'deps-ready', ytdlpPath });
  return ytdlpPath;
}

async function main() {
  const b64 = process.argv[2];
  if (!b64) {
    emit({ type: 'error', message: 'Usage: yt-download-sidecar <base64-json>' });
    process.exit(1);
  }

  let input: { action: string; [key: string]: unknown };
  try {
    const raw = Buffer.from(b64, 'base64').toString('utf-8');
    input = JSON.parse(raw);
  } catch {
    emit({ type: 'error', message: 'Invalid base64 JSON argument' });
    process.exit(1);
  }

  switch (input.action) {
    case 'ensure-deps': {
      const dataDir = input.dataDir as string;
      if (!dataDir) {
        emit({ type: 'error', message: 'Missing dataDir for ensure-deps action' });
        process.exit(1);
      }
      await ensureDeps(dataDir);
      break;
    }

    case 'run': {
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

      await runBackup(config, (event) => emit(event), {
        ytdlpPath: input.ytdlpPath as string | undefined,
      });
      break;
    }

    default:
      emit({ type: 'error', message: `Unknown action: ${input.action}` });
      process.exit(1);
  }
}

main().catch((err) => {
  emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
