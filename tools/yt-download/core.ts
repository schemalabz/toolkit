import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { BackupConfig, ProgressEvent } from './types.js';

/**
 * Extract YouTube video ID from various URL formats.
 */
export function extractVideoId(url: string): string {
  if (url.includes('youtube.com/watch')) {
    const videoId = new URL(url).searchParams.get('v');
    if (videoId) return videoId;
  } else if (url.includes('youtu.be/')) {
    const videoId = url.split('youtu.be/')[1]?.split(/[?&#/]/)[0];
    if (videoId) return videoId;
  } else if (url.includes('youtube.com/embed/')) {
    const videoId = url.split('youtube.com/embed/')[1]?.split(/[?&#/]/)[0];
    if (videoId) return videoId;
  }

  throw new Error(`Could not extract video ID from URL: ${url}`);
}

/**
 * Download a YouTube video using yt-dlp.
 * Skips download if file already exists and is non-empty.
 */
export async function downloadVideo(
  url: string,
  videoId: string,
  outputDir: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${videoId}.mp4`);

  // Skip if already downloaded
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    onProgress({ type: 'status', message: `Video already exists (${sizeMb} MB), skipping download` });
    return outputPath;
  }

  onProgress({ type: 'status', message: 'Downloading video...' });

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputPath,
      '--newline',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      // Parse yt-dlp progress: [download]  45.2% of 512.00MiB at 10.00MiB/s
      const match = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\S+)\s/);
      if (match) {
        onProgress({
          type: 'download-progress',
          percent: parseFloat(match[1]),
          downloaded: '', // yt-dlp doesn't provide this directly in this format
          total: match[2],
        });
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // Clean up partial download
        try { fs.unlinkSync(outputPath); } catch {}
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        reject(new Error('yt-dlp finished but no output file was created'));
        return;
      }

      const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
      onProgress({ type: 'status', message: `Download complete (${sizeMb} MB)` });
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`));
    });
  });
}

/**
 * Upload a video file to the opencouncil-tasks server.
 */
export async function uploadToServer(
  filePath: string,
  videoId: string,
  serverUrl: string,
  apiKey: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<string> {
  onProgress({ type: 'upload-progress', status: 'uploading' });

  const fileStream = fs.readFileSync(filePath);
  const blob = new Blob([fileStream]);

  const form = new FormData();
  form.append('videoId', videoId);
  form.append('video', blob, `${videoId}.mp4`);

  const url = `${serverUrl.replace(/\/$/, '')}/upload-video`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server upload failed (${response.status}): ${text}`);
  }

  const result = await response.json() as { cdnUrl: string; videoId: string; size: number };

  onProgress({ type: 'upload-progress', status: 'done' });

  return result.cdnUrl;
}

/**
 * Run the full backup flow: extract ID → download → upload.
 */
export async function runBackup(
  config: BackupConfig,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  const videoId = extractVideoId(config.youtubeUrl);
  onProgress({ type: 'status', message: `Video ID: ${videoId}` });

  const filePath = await downloadVideo(config.youtubeUrl, videoId, config.outputDir, onProgress);

  if (config.localOnly) {
    onProgress({ type: 'status', message: `Local-only mode — file saved to ${filePath}` });
    return;
  }

  if (!config.serverUrl || !config.apiKey) {
    throw new Error('TASK_API_URL and TASK_API_KEY are required for upload (set in .env or use --local-only)');
  }

  const cdnUrl = await uploadToServer(filePath, videoId, config.serverUrl, config.apiKey, onProgress);
  onProgress({ type: 'complete', cdnUrl });
}
