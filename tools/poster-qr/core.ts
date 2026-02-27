import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { Jimp } from 'jimp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PosterConfig, MarkerResult, ProgressEvent } from './types.js';

// PDF page sizes in points (1 point = 1/72 inch)
export const PAGE_SIZES = {
  A4: [595.28, 841.89] as const,
  A3: [841.89, 1190.55] as const,
};

export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export async function detectMarker(
  templatePath: string,
  markerHex: string,
  tolerance: number = 30,
): Promise<MarkerResult> {
  const [targetR, targetG, targetB] = parseHexColor(markerHex);

  const image = await Jimp.read(templatePath);
  const { width, height, data } = image.bitmap;
  if (!width || !height) throw new Error('Could not read image dimensions');

  // Jimp always gives RGBA (4 channels)
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let matchCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
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
  const bleed = 4;
  const size = Math.max(w, h) + bleed * 2;

  return {
    x: Math.max(0, minX - bleed),
    y: Math.max(0, minY - bleed),
    size,
    matchCount,
    boundingBox: { minX, minY, width: w, height: h },
  };
}

export function formatId(n: number, prefix: string, padDigits: number): string {
  return `${prefix}${String(n).padStart(padDigits, '0')}`;
}

export function buildUrl(baseUrl: string, id: string, source: string, campaign: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'poster');
  if (campaign) url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', id);
  return url.toString();
}

/**
 * Compute ID label position in PDF coordinate space (origin at bottom-left).
 * The font size is scaled from image pixels to PDF points using the same
 * ratio as the poster image → page mapping.
 */
function computeIdLabelPosition(
  corner: string,
  fontSize: number,
  offset: number,
  pageW: number,
  pageH: number,
  posterWidth: number,
  posterHeight: number,
): { x: number; y: number; pdfFontSize: number } {
  const scaleX = pageW / posterWidth;
  const scaleY = pageH / posterHeight;
  const pdfOffset = offset * scaleX;
  const pdfFontSize = fontSize * scaleY;

  let x: number;
  let y: number;

  switch (corner) {
    case 'top-left':
      x = pdfOffset;
      y = pageH - pdfOffset - pdfFontSize;
      break;
    case 'top-right':
      // We'll right-align by measuring text width later; for now set x to right edge minus offset
      x = pageW - pdfOffset;
      y = pageH - pdfOffset - pdfFontSize;
      break;
    case 'bottom-right':
      x = pageW - pdfOffset;
      y = pdfOffset;
      break;
    case 'bottom-left':
    default:
      x = pdfOffset;
      y = pdfOffset;
      break;
  }

  return { x, y, pdfFontSize };
}

export async function generatePreview(opts: {
  templatePath: string;
  detect?: boolean;
  markerColor?: string;
  qrX?: number;
  qrY?: number;
  qrSize?: number;
  baseUrl?: string;
  maxWidth?: number;
}): Promise<{
  imageBase64: string;
  width: number;
  height: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  detected: boolean;
}> {
  const maxWidth = opts.maxWidth ?? 600;
  const image = await Jimp.read(opts.templatePath);
  const width = image.width;
  const height = image.height;

  let qrX = opts.qrX ?? 0;
  let qrY = opts.qrY ?? 0;
  let qrSize = opts.qrSize ?? 0;
  let detected = false;

  if (opts.detect) {
    const marker = await detectMarker(opts.templatePath, opts.markerColor ?? 'FF00FF');
    qrX = marker.x;
    qrY = marker.y;
    qrSize = marker.size;
    detected = true;
  }

  if (qrSize > 0) {
    const sampleUrl = opts.baseUrl
      ? buildUrl(opts.baseUrl, 'SAMPLE', 'qr', '')
      : 'https://example.com/?utm_content=SAMPLE';
    const qrBuffer = await QRCode.toBuffer(sampleUrl, {
      type: 'png',
      width: qrSize,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    const qrImage = await Jimp.fromBuffer(qrBuffer);
    const whiteRect = new Jimp({ width: qrSize, height: qrSize, color: 0xFFFFFFFF });
    image.composite(whiteRect, qrX, qrY);
    image.composite(qrImage, qrX, qrY);
  }

  if (image.width > maxWidth) {
    image.resize({ w: maxWidth });
  }

  const pngBuffer = await image.getBuffer('image/png');
  const imageBase64 = Buffer.from(pngBuffer).toString('base64');

  return { imageBase64, width, height, qrX, qrY, qrSize, detected };
}

export async function generatePosters(
  config: PosterConfig,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  const {
    templatePath, baseUrl, campaign, source, batches, start,
    prefix, padDigits, outDir, dryRun,
    qrX, qrY, qrSize,
    idCorner, idSize, idColor, idOffset,
  } = config;

  const templateImage = await Jimp.read(templatePath);
  const posterWidth = templateImage.width;
  const posterHeight = templateImage.height;
  const totalCount = batches.reduce((sum, b) => sum + b.count, 0);

  onProgress({ type: 'info', message: `Template: ${templatePath} (${posterWidth}x${posterHeight})` });
  onProgress({ type: 'info', message: `URL: ${baseUrl}` });
  onProgress({ type: 'info', message: `utm_source: ${source}` });
  onProgress({ type: 'info', message: `utm_medium: poster` });
  if (campaign) onProgress({ type: 'info', message: `utm_campaign: ${campaign}` });
  onProgress({ type: 'info', message: `IDs: ${formatId(start, prefix, padDigits)} -> ${formatId(start + totalCount - 1, prefix, padDigits)}` });
  onProgress({ type: 'info', message: `Batches: ${batches.map(b => `${b.count}x ${b.paper}`).join(', ')}` });
  onProgress({ type: 'info', message: `QR position: (${qrX}, ${qrY}) ${qrSize}x${qrSize}px` });
  onProgress({ type: 'info', message: `ID label: ${idCorner}, ${idSize}px, ${idColor}` });
  onProgress({ type: 'info', message: `Output: ${outDir}` });

  if (dryRun) {
    let currentId = start;
    for (const batch of batches) {
      for (let i = 0; i < batch.count; i++) {
        const id = formatId(currentId, prefix, padDigits);
        const url = buildUrl(baseUrl, id, source, campaign);
        onProgress({ type: 'dry-run-item', id, paper: batch.paper, url });
        currentId++;
      }
    }
    onProgress({ type: 'dry-run-done', totalCount });
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  // Print DPI info
  for (const batch of batches) {
    const [pageW] = PAGE_SIZES[batch.paper];
    const pageWidthInches = pageW / 72;
    const dpi = Math.round(posterWidth / pageWidthInches);
    onProgress({ type: 'info', message: `${batch.paper}: ${dpi} DPI effective resolution` });
  }

  // Read template as buffer for re-use (Jimp.read each iteration to get a fresh copy)
  const templateBuffer = fs.readFileSync(templatePath);

  // Pre-create a white rectangle image for blanking the QR area
  const whiteRect = new Jimp({ width: qrSize, height: qrSize, color: 0xFFFFFFFF });

  // Parse ID label color for pdf-lib
  const [idR, idG, idB] = parseHexColor(idColor);
  const pdfIdColor = rgb(idR / 255, idG / 255, idB / 255);

  // Create a PDF per paper size
  const pdfs = new Map<string, InstanceType<typeof PDFDocument>>();
  for (const batch of batches) {
    pdfs.set(batch.paper, await PDFDocument.create());
  }

  let currentId = start;
  let posterIndex = 0;

  for (const batch of batches) {
    const [pageW, pageH] = PAGE_SIZES[batch.paper];
    const pdf = pdfs.get(batch.paper)!;
    const courierFont = await pdf.embedFont(StandardFonts.Courier);

    onProgress({ type: 'batch-start', paper: batch.paper, count: batch.count });

    for (let i = 0; i < batch.count; i++) {
      const id = formatId(currentId, prefix, padDigits);
      const url = buildUrl(baseUrl, id, source, campaign);
      currentId++;
      posterIndex++;

      // Generate QR code as PNG buffer
      const qrBuffer = await QRCode.toBuffer(url, {
        type: 'png',
        width: qrSize,
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      const qrImage = await Jimp.fromBuffer(qrBuffer);

      // Composite onto a fresh copy of the template: white blank → QR
      const poster = (await Jimp.fromBuffer(templateBuffer))
        .composite(whiteRect, qrX, qrY)
        .composite(qrImage, qrX, qrY);

      const posterPng = await poster.getBuffer('image/png');

      // Embed in PDF
      const pdfImage = await pdf.embedPng(posterPng);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(pdfImage, { x: 0, y: 0, width: pageW, height: pageH });

      // Draw ID label as vector text on the PDF page
      const { x: labelX, y: labelY, pdfFontSize } = computeIdLabelPosition(
        idCorner, idSize, idOffset, pageW, pageH, posterWidth, posterHeight,
      );

      // For right-aligned corners, shift x left by text width
      let finalX = labelX;
      if (idCorner === 'top-right' || idCorner === 'bottom-right') {
        const textWidth = courierFont.widthOfTextAtSize(id, pdfFontSize);
        finalX = labelX - textWidth;
      }

      page.drawText(id, {
        x: finalX,
        y: labelY,
        size: pdfFontSize,
        font: courierFont,
        color: pdfIdColor,
      });

      onProgress({ type: 'poster', id, paper: batch.paper, index: posterIndex, total: totalCount });
    }
  }

  for (const [paper, pdf] of pdfs) {
    const pdfBytes = await pdf.save();
    const pdfPath = path.join(outDir, `posters-${paper.toLowerCase()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBytes);
    const sizeMb = (pdfBytes.length / 1024 / 1024).toFixed(1);
    onProgress({ type: 'pdf-saved', paper, path: pdfPath, sizeMb });
  }

  onProgress({ type: 'done', totalCount });
}
