#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { detectMarker, formatId, generatePosters } from './core.js';
import type { PaperBatch, PosterConfig, ProgressEvent } from './types.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const opts: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      opts[key] = rest.join('=') || 'true';
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

// ---------------------------------------------------------------------------
// Config resolution (CLI-specific: interactive prompts, process.exit)
// ---------------------------------------------------------------------------

async function resolveConfig(opts: Record<string, string>): Promise<PosterConfig> {
  const ask = createPrompt();
  const isInteractive = process.stdin.isTTY && !opts['dry-run'];

  async function resolve(key: string, prompt: string, defaultVal?: string): Promise<string> {
    if (opts[key]) return opts[key];
    if (!isInteractive) {
      if (defaultVal !== undefined) return defaultVal;
      console.error(`Error: --${key} is required`);
      process.exit(1);
    }
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    const answer = await ask(`${prompt}${suffix}: `);
    return answer || defaultVal || '';
  }

  const template = await resolve('template', 'Path to poster template image');
  const templatePath = path.resolve(template);
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: Template not found: ${templatePath}`);
    process.exit(1);
  }

  const baseUrl = await resolve('base-url', 'Base URL');
  try {
    new URL(baseUrl);
  } catch {
    console.error(`Error: Invalid URL: ${baseUrl}`);
    process.exit(1);
  }

  const campaign = opts['campaign'] ?? (isInteractive ? await ask('Campaign name (utm_campaign, optional): ') : '');
  const source = await resolve('source', 'UTM source (utm_source)', 'qr');

  const batches: PaperBatch[] = [];
  const a3Count = opts['a3'] ? parseInt(opts['a3'], 10) : 0;
  const a4Count = opts['a4'] ? parseInt(opts['a4'], 10) : 0;
  const legacyCount = opts['count'] ? parseInt(opts['count'], 10) : 0;

  if (a3Count > 0) batches.push({ paper: 'A3', count: a3Count });
  if (a4Count > 0) batches.push({ paper: 'A4', count: a4Count });

  if (batches.length === 0 && legacyCount > 0) {
    batches.push({ paper: 'A4', count: legacyCount });
  }

  if (batches.length === 0) {
    const a3Str = await ask('How many A3 posters? (0): ');
    const a4Str = await ask('How many A4 posters? (0): ');
    const a3 = parseInt(a3Str || '0', 10);
    const a4 = parseInt(a4Str || '0', 10);
    if (a3 > 0) batches.push({ paper: 'A3', count: a3 });
    if (a4 > 0) batches.push({ paper: 'A4', count: a4 });
  }

  const totalCount = batches.reduce((sum, b) => sum + b.count, 0);
  if (totalCount < 1) {
    console.error('Error: At least one poster must be requested (use --a4=N, --a3=N, or --count=N)');
    process.exit(1);
  }

  const startStr = await resolve('start', 'Starting ID number', '1');
  const start = parseInt(startStr, 10);

  const detect = opts['detect'] === 'true';
  let qrX: number, qrY: number, qrSize: number;

  if (detect) {
    const markerColor = opts['marker-color'] ?? 'FF00FF';
    console.log(`  Scanning for #${markerColor} placeholder...`);
    const detected = await detectMarker(templatePath, markerColor);
    console.log(`  Detected marker: ${detected.matchCount} pixels, bounding box (${detected.boundingBox.minX},${detected.boundingBox.minY}) ${detected.boundingBox.width}x${detected.boundingBox.height}px`);
    qrX = detected.x;
    qrY = detected.y;
    qrSize = detected.size;
  } else {
    const qrXStr = await resolve('qr-x', 'QR code X position (px)');
    const qrYStr = await resolve('qr-y', 'QR code Y position (px)');
    const qrSizeStr = await resolve('qr-size', 'QR code size (px)');
    qrX = parseInt(qrXStr, 10);
    qrY = parseInt(qrYStr, 10);
    qrSize = parseInt(qrSizeStr, 10);
  }

  const prefix = opts['prefix'] ?? '';
  const padDigits = parseInt(opts['pad'] ?? '0', 10) || String(start + totalCount - 1).length;
  const outDir = opts['out-dir'] ?? './qr-output';
  const dryRun = opts['dry-run'] === 'true';

  const idCorner = (opts['id-corner'] ?? 'bottom-left') as PosterConfig['idCorner'];
  const idSize = parseInt(opts['id-size'] ?? '48', 10);
  const idColor = opts['id-color'] ?? '#999999';
  const idOffset = parseInt(opts['id-offset'] ?? '150', 10);

  return {
    templatePath, baseUrl, campaign, source, batches, start,
    prefix, padDigits, outDir, dryRun,
    qrX, qrY, qrSize,
    idCorner, idSize, idColor, idOffset,
  };
}

// ---------------------------------------------------------------------------
// Progress callback for console output
// ---------------------------------------------------------------------------

function consoleProgress(event: ProgressEvent) {
  switch (event.type) {
    case 'info':
      console.log(`  ${event.message}`);
      break;
    case 'batch-start':
      console.log(`\n  --- ${event.paper} (${event.count} posters) ---`);
      break;
    case 'poster':
      console.log(`  poster-${event.id}`);
      break;
    case 'pdf-saved':
      console.log(`  ${event.path} (${event.sizeMb} MB)`);
      break;
    case 'done':
      console.log(`\nDone! Generated ${event.totalCount} posters.`);
      break;
    case 'dry-run-item':
      console.log(`  ${event.id} [${event.paper}] -> ${event.url}`);
      break;
    case 'dry-run-done':
      console.log(`\nDry run complete. ${event.totalCount} posters would be generated.`);
      break;
    case 'error':
      console.error(`Error: ${event.message}`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `Generate print-ready poster PDFs with unique QR codes and ID labels.

Usage:
  npx tsx tools/poster-qr/cli.ts --template=poster.png [options]

Options:
  --template=PATH       Poster template image (required)
  --base-url=URL        Base URL before UTM params (required)
  --campaign=NAME       utm_campaign value (required)
  --source=NAME         utm_source value (default: "qr")
  --a4=N                Number of A4 posters to generate
  --a3=N                Number of A3 posters to generate
  --count=N             Total posters (all A4, shorthand for --a4=N)
  --start=N             First poster ID number (default: 1)
  --prefix=STR          ID prefix, e.g. "P" for P001 (default: none)
  --pad=N               Zero-pad IDs to N digits (default: auto)
  --detect              Auto-detect QR position from #FF00FF placeholder
  --marker-color=HEX    Custom marker color instead of #FF00FF (default: "FF00FF")
  --qr-x=N             QR left edge X position in px (manual mode)
  --qr-y=N             QR top edge Y position in px (manual mode)
  --qr-size=N           QR code size in px (manual mode)
  --id-corner=POS       Corner for ID label: top-left, top-right, bottom-left, bottom-right (default: bottom-left)
  --id-size=N           ID label font size in px (default: 48)
  --id-color=HEX        ID label color (default: "#999999")
  --id-offset=N         ID label offset from corner in px (default: 150)
  --out-dir=PATH        Output directory (default: "./qr-output")
  --dry-run             Preview without generating files

Examples:
  # 20 A3 posters + 30 A4 posters (IDs 1-20 in A3 PDF, 21-50 in A4 PDF)
  npx tsx tools/poster-qr/cli.ts \\
    --template=poster.png --detect \\
    --base-url=https://opencouncil.gr/zografou \\
    --campaign=zografou25 --a3=20 --a4=30

  # 50 A4 posters (shorthand)
  npx tsx tools/poster-qr/cli.ts \\
    --template=poster.png --detect \\
    --base-url=https://opencouncil.gr/zografou \\
    --campaign=zografou25 --count=50`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  if (opts['help']) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  console.log('');
  console.log(`Generating posters...`);

  const config = await resolveConfig(opts);
  await generatePosters(config, consoleProgress);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
