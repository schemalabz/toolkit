#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { runBackup } from './core.js';
import type { BackupConfig, ProgressEvent } from './types.js';

dotenv.config();

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const opts: Record<string, string> = {};
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      opts[key] = rest.join('=') || 'true';
    } else {
      positional.push(arg);
    }
  }

  return { opts, positional };
}

// ---------------------------------------------------------------------------
// Progress callback for console output
// ---------------------------------------------------------------------------

function consoleProgress(event: ProgressEvent) {
  switch (event.type) {
    case 'status':
      console.log(event.message);
      break;
    case 'download-progress':
      process.stdout.write(`\rDownloading video... ${event.percent.toFixed(1)}% of ${event.total}  `);
      break;
    case 'upload-progress':
      if (event.status === 'uploading') {
        console.log('Uploading to server...');
      } else {
        console.log('Upload complete.');
      }
      break;
    case 'complete':
      console.log('');
      console.log('Done! Use this CDN URL in the opencouncil admin UI:');
      console.log(`  ${event.cdnUrl}`);
      break;
    case 'error':
      console.error(`Error: ${event.message}`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `Download YouTube videos and upload to the opencouncil-tasks server.

Usage:
  npm run yt-download -- <youtubeUrl> [options]

Options:
  --local-only       Download only, don't upload to server
  --output-dir=PATH  Output directory (default: ./data)
  --help             Show this help

Environment variables (or .env file):
  TASK_API_URL       Server URL (required for upload)
  TASK_API_KEY       API key (required for upload)

Examples:
  # Download and upload
  npm run yt-download -- "https://youtube.com/watch?v=dQw4w9WgXcQ"

  # Download only (no server upload)
  npm run yt-download -- "https://youtube.com/watch?v=dQw4w9WgXcQ" --local-only

  # Custom output directory
  npm run yt-download -- "https://youtube.com/watch?v=dQw4w9WgXcQ" --output-dir=./downloads`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { opts, positional } = parseArgs(process.argv);

  if (opts['help']) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const youtubeUrl = positional[0];
  if (!youtubeUrl) {
    console.error('Error: YouTube URL is required\n');
    console.log(HELP_TEXT);
    process.exit(1);
  }

  const config: BackupConfig = {
    youtubeUrl,
    outputDir: opts['output-dir'] || './data',
    localOnly: opts['local-only'] === 'true',
    serverUrl: process.env.TASK_API_URL || '',
    apiKey: process.env.TASK_API_KEY || '',
  };

  if (!config.localOnly && (!config.serverUrl || !config.apiKey)) {
    console.error('Error: TASK_API_URL and TASK_API_KEY are required for upload.');
    console.error('Set them in .env or use --local-only for download-only mode.\n');
    process.exit(1);
  }

  await runBackup(config, consoleProgress);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
