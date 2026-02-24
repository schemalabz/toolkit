#!/usr/bin/env tsx

/**
 * Generate print-ready poster PDFs with unique QR codes and ID labels.
 *
 * Takes a poster template image, generates sequential QR codes with UTM tracking,
 * and composites each QR + a subtle ID label directly onto the poster.
 * Outputs separate PDFs per paper size, ready for professional printing.
 *
 * QR placement can be specified manually (--qr-x, --qr-y, --qr-size) or detected
 * automatically from a magenta (#FF00FF) placeholder rectangle in the template.
 *
 * Workflow for auto-detection:
 *   1. In your design tool (Canva, Figma, etc.), add a square with color #FF00FF
 *      where the QR code should go
 *   2. Export the template as PNG (use max resolution for print quality)
 *   3. Run the script with --detect — it finds the magenta area automatically
 *
 * Usage:
 *   npx tsx tools/poster-qr.ts --template=poster.png [options]
 *
 * Options:
 *   --template=PATH       Poster template image (required)
 *   --base-url=URL        Base URL before UTM params (required)
 *   --campaign=NAME       utm_campaign value (required)
 *   --source=NAME         utm_source value (default: "qr")
 *   --a4=N                Number of A4 posters to generate
 *   --a3=N                Number of A3 posters to generate
 *   --count=N             Total posters (all A4, shorthand for --a4=N)
 *   --start=N             First poster ID number (default: 1)
 *   --prefix=STR          ID prefix, e.g. "P" for P001 (default: none)
 *   --pad=N               Zero-pad IDs to N digits (default: auto)
 *   --detect              Auto-detect QR position from #FF00FF placeholder
 *   --marker-color=HEX    Custom marker color instead of #FF00FF (default: "FF00FF")
 *   --qr-x=N              QR left edge X position in px (manual mode)
 *   --qr-y=N              QR top edge Y position in px (manual mode)
 *   --qr-size=N           QR code size in px (manual mode)
 *   --id-corner=POS       Corner for ID label: top-left, top-right, bottom-left, bottom-right (default: bottom-left)
 *   --id-size=N           ID label font size in px (default: 48)
 *   --id-color=HEX        ID label color (default: "#999999")
 *   --id-offset=N         ID label offset from corner in px (default: 150)
 *   --out-dir=PATH        Output directory (default: "./qr-output")
 *   --dry-run             Preview without generating files
 *
 * Examples:
 *   # 20 A3 posters + 30 A4 posters (IDs 1-20 in A3 PDF, 21-50 in A4 PDF)
 *   npx tsx tools/poster-qr.ts \
 *     --template=poster.png --detect \
 *     --base-url=https://opencouncil.gr/zografou \
 *     --campaign=zografou25 --a3=20 --a4=30
 *
 *   # 50 A4 posters (shorthand)
 *   npx tsx tools/poster-qr.ts \
 *     --template=poster.png --detect \
 *     --base-url=https://opencouncil.gr/zografou \
 *     --campaign=zografou25 --count=50
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

// PDF page sizes in points (1 point = 1/72 inch)
const PAGE_SIZES = {
  A4: [595.28, 841.89] as const,
  A3: [841.89, 1190.55] as const,
};

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
// Marker detection — find a colored placeholder rectangle in the image
// ---------------------------------------------------------------------------

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

async function detectMarker(
  templatePath: string,
  markerHex: string,
  tolerance: number = 30,
): Promise<{ x: number; y: number; size: number }> {
  const [targetR, targetG, targetB] = parseHexColor(markerHex);

  const image = sharp(templatePath);
  const { width, height, channels } = await image.metadata();
  if (!width || !height) throw new Error('Could not read image dimensions');

  const { data } = await image.raw().toBuffer({ resolveWithObject: true });

  const ch = channels ?? 3;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let matchCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * ch;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (
        Math.abs(r - targetR) <= tolerance &&
        Math.abs(g - targetG) <= tolerance &&
        Math.abs(b - targetB) <= tolerance
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        matchCount++;
      }
    }
  }

  if (matchCount === 0) {
    throw new Error(
      `No pixels matching marker color #${markerHex} found (tolerance: ${tolerance}). ` +
      `Make sure your template has a #${markerHex} rectangle where the QR should go.`
    );
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  // Use the larger dimension as the square size, slightly enlarged to cover
  // anti-aliased edges from the design tool's export
  const bleed = 4;
  const size = Math.max(w, h) + bleed * 2;

  console.log(`  Detected marker: ${matchCount} pixels, bounding box (${minX},${minY}) ${w}x${h}px`);

  return { x: Math.max(0, minX - bleed), y: Math.max(0, minY - bleed), size };
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

interface PaperBatch {
  paper: 'A4' | 'A3';
  count: number;
}

async function resolveConfig(opts: Record<string, string>) {
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

  // Paper sizes and counts
  const batches: PaperBatch[] = [];
  const a3Count = opts['a3'] ? parseInt(opts['a3'], 10) : 0;
  const a4Count = opts['a4'] ? parseInt(opts['a4'], 10) : 0;
  const legacyCount = opts['count'] ? parseInt(opts['count'], 10) : 0;

  if (a3Count > 0) batches.push({ paper: 'A3', count: a3Count });
  if (a4Count > 0) batches.push({ paper: 'A4', count: a4Count });

  // --count=N is shorthand for --a4=N
  if (batches.length === 0 && legacyCount > 0) {
    batches.push({ paper: 'A4', count: legacyCount });
  }

  // Interactive: ask for counts if nothing specified
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

  // QR placement: auto-detect or manual
  const detect = opts['detect'] === 'true';
  let qrX: number, qrY: number, qrSize: number;

  if (detect) {
    const markerColor = opts['marker-color'] ?? 'FF00FF';
    console.log(`  Scanning for #${markerColor} placeholder...`);
    const detected = await detectMarker(templatePath, markerColor);
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

  const idCorner = (opts['id-corner'] ?? 'bottom-left') as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
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
// ID + URL helpers
// ---------------------------------------------------------------------------

function formatId(n: number, prefix: string, padDigits: number): string {
  return `${prefix}${String(n).padStart(padDigits, '0')}`;
}

function buildUrl(baseUrl: string, id: string, source: string, campaign: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'poster');
  if (campaign) url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', id);
  return url.toString();
}

// ---------------------------------------------------------------------------
// SVG text overlay for the ID label
// ---------------------------------------------------------------------------

function createIdLabelSvg(
  id: string,
  posterWidth: number,
  posterHeight: number,
  corner: string,
  fontSize: number,
  color: string,
  offset: number,
): Buffer {
  let x: number;
  let y: number;
  let anchor: string;

  switch (corner) {
    case 'top-left':
      x = offset;
      y = offset + fontSize;
      anchor = 'start';
      break;
    case 'top-right':
      x = posterWidth - offset;
      y = offset + fontSize;
      anchor = 'end';
      break;
    case 'bottom-right':
      x = posterWidth - offset;
      y = posterHeight - offset;
      anchor = 'end';
      break;
    case 'bottom-left':
    default:
      x = offset;
      y = posterHeight - offset;
      anchor = 'start';
      break;
  }

  const svg = `<svg width="${posterWidth}" height="${posterHeight}" xmlns="http://www.w3.org/2000/svg">
    <text x="${x}" y="${y}" font-family="monospace" font-size="${fontSize}" fill="${color}" text-anchor="${anchor}">${id}</text>
  </svg>`;

  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  if (opts['help']) {
    const source = fs.readFileSync(__filename, 'utf-8');
    const match = source.match(/\/\*\*([\s\S]*?)\*\//);
    if (match) console.log(match[1].replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }

  const config = await resolveConfig(opts);
  const {
    templatePath, baseUrl, campaign, source, batches, start,
    prefix, padDigits, outDir, dryRun,
    qrX, qrY, qrSize,
    idCorner, idSize, idColor, idOffset,
  } = config;

  // Get template dimensions
  const templateMeta = await sharp(templatePath).metadata();
  const posterWidth = templateMeta.width!;
  const posterHeight = templateMeta.height!;
  const totalCount = batches.reduce((sum, b) => sum + b.count, 0);

  console.log('');
  console.log(`Generating ${totalCount} posters...`);
  console.log(`  Template:     ${templatePath} (${posterWidth}x${posterHeight})`);
  console.log(`  URL:          ${baseUrl}`);
  console.log(`  utm_source:   ${source}`);
  console.log(`  utm_medium:   poster`);
  if (campaign) console.log(`  utm_campaign: ${campaign}`);
  console.log(`  IDs:          ${formatId(start, prefix, padDigits)} -> ${formatId(start + totalCount - 1, prefix, padDigits)}`);
  console.log(`  Batches:      ${batches.map(b => `${b.count}x ${b.paper}`).join(', ')}`);
  console.log(`  QR position:  (${qrX}, ${qrY}) ${qrSize}x${qrSize}px`);
  console.log(`  ID label:     ${idCorner}, ${idSize}px, ${idColor}`);
  console.log(`  Output:       ${outDir}`);
  if (dryRun) console.log('  ** DRY RUN — no files will be written **');
  console.log('');

  if (!dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Read template once into a buffer
  const templateBuffer = fs.readFileSync(templatePath);

  // Print DPI info per paper size
  if (!dryRun) {
    for (const batch of batches) {
      const [pageW] = PAGE_SIZES[batch.paper];
      const pageWidthInches = pageW / 72;
      const dpi = Math.round(posterWidth / pageWidthInches);
      console.log(`  ${batch.paper}: ${dpi} DPI effective resolution`);
    }
    console.log('');
  }

  // Create a PDF per paper size
  const pdfs = new Map<string, typeof PDFDocument extends new () => infer R ? R : never>();
  if (!dryRun) {
    for (const batch of batches) {
      pdfs.set(batch.paper, await PDFDocument.create());
    }
  }

  let currentId = start;

  for (const batch of batches) {
    const [pageW, pageH] = PAGE_SIZES[batch.paper];
    const pdf = pdfs.get(batch.paper)!;

    console.log(`  --- ${batch.paper} (${batch.count} posters) ---`);

    for (let i = 0; i < batch.count; i++) {
      const id = formatId(currentId, prefix, padDigits);
      const url = buildUrl(baseUrl, id, source, campaign);
      currentId++;

      if (dryRun) {
        console.log(`  ${id} [${batch.paper}] -> ${url}`);
        continue;
      }

      // Generate QR code as PNG buffer
      const qrBuffer = await QRCode.toBuffer(url, {
        type: 'png',
        width: qrSize,
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
      });

      // White rectangle to blank out the placeholder / old QR area
      const whiteRect = await sharp({
        create: { width: qrSize, height: qrSize, channels: 3, background: '#FFFFFF' },
      }).png().toBuffer();

      // Create ID label SVG
      const idSvg = createIdLabelSvg(id, posterWidth, posterHeight, idCorner, idSize, idColor, idOffset);

      // Composite: white blank -> QR -> ID label onto template
      const posterPng = await sharp(templateBuffer)
        .composite([
          { input: whiteRect, left: qrX, top: qrY },
          { input: qrBuffer, left: qrX, top: qrY },
          { input: idSvg, left: 0, top: 0 },
        ])
        .png()
        .toBuffer();

      // Add as a page to the PDF with proper paper dimensions
      const pdfImage = await pdf.embedPng(posterPng);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(pdfImage, { x: 0, y: 0, width: pageW, height: pageH });

      console.log(`  poster-${id}`);
    }
  }

  if (!dryRun) {
    console.log('');
    for (const [paper, pdf] of pdfs) {
      const pdfBytes = await pdf.save();
      const pdfPath = path.join(outDir, `posters-${paper.toLowerCase()}.pdf`);
      fs.writeFileSync(pdfPath, pdfBytes);
      const sizeMb = (pdfBytes.length / 1024 / 1024).toFixed(1);
      console.log(`  ${pdfPath} (${sizeMb} MB)`);
    }
    console.log(`\nDone! Generated ${totalCount} posters.`);
  } else {
    console.log(`\nDry run complete. ${totalCount} posters would be generated.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
