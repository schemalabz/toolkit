#!/usr/bin/env bun

/**
 * Sidecar entry point for the Tauri desktop app.
 *
 * Accepts input as a base64-encoded JSON argument:
 *   poster-qr-sidecar <base64-json>
 *
 * The JSON payload has an "action" field:
 *   - "detect-marker": { templatePath, markerColor?, tolerance? }
 *   - "generate": { config: PosterConfig }
 *
 * Writes NDJSON progress events to stdout. Errors are emitted as
 * {"type":"error","message":"..."} and the process exits with code 1.
 */

import { detectMarker, generatePosters } from './core.js';
import type { PosterConfig, ProgressEvent } from './types.js';

function emit(event: ProgressEvent) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

async function main() {
  const b64 = process.argv[2];
  if (!b64) {
    emit({ type: 'error', message: 'Usage: poster-qr-sidecar <base64-json>' });
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
    case 'detect-marker': {
      const templatePath = input.templatePath as string;
      const markerColor = (input.markerColor as string) ?? 'FF00FF';
      const tolerance = (input.tolerance as number) ?? 30;

      if (!templatePath) {
        emit({ type: 'error', message: 'Missing templatePath for detect-marker action' });
        process.exit(1);
      }

      const result = await detectMarker(templatePath, markerColor, tolerance);
      process.stdout.write(JSON.stringify({ type: 'marker-result', ...result }) + '\n');
      break;
    }

    case 'generate': {
      const config = input.config as PosterConfig;
      if (!config) {
        emit({ type: 'error', message: 'Missing config for generate action' });
        process.exit(1);
      }
      await generatePosters(config, emit);
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
