#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { createSidecar } from '../shared/sidecar-harness.js';
import {
  clearMacosAttributes,
  denoAssetName,
  ensureBinary,
  ensureZippedBinary,
  ffmpegAssetName,
  resolveBinDir,
  ytdlpAssetName,
} from '../shared/binaries.js';
import { runBackup } from './core.js';

const FFMPEG_RELEASE = 'https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1';

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

    const binDir = resolveBinDir(dataDir);

    const ytdlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAssetName()}`;
    const ytdlpPath = await ensureBinary(binDir, 'yt-dlp', ytdlpUrl, emit);
    refreshYtdlp(ytdlpPath, emit);

    const ffmpegUrl = `${FFMPEG_RELEASE}/${ffmpegAssetName('ffmpeg')}`;
    const ffmpegPath = await ensureBinary(binDir, 'ffmpeg', ffmpegUrl, emit);

    // yt-dlp's JavaScript runtime — without it YouTube extraction falls back to
    // deprecated clients and 403s. See buildYtdlpArgs in core.ts.
    const denoUrl = `https://github.com/denoland/deno/releases/latest/download/${denoAssetName()}`;
    const denoPath = await ensureZippedBinary(binDir, 'deno', denoUrl, emit);

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
