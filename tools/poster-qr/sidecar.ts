#!/usr/bin/env bun

import { createSidecar } from '../shared/sidecar-harness.js';
import { detectMarker, generatePosters, generatePreview } from './core.js';
import type { PosterConfig, ProgressEvent } from './types.js';

createSidecar({
  'detect-marker': async (input, emit) => {
    const templatePath = input.templatePath as string;
    const markerColor = (input.markerColor as string) ?? 'FF00FF';
    const tolerance = (input.tolerance as number) ?? 30;

    if (!templatePath) {
      emit({ type: 'error', message: 'Missing templatePath for detect-marker action' });
      process.exit(1);
    }

    const result = await detectMarker(templatePath, markerColor, tolerance);
    emit({ type: 'marker-result', ...result });
  },

  'preview': async (input, emit) => {
    const result = await generatePreview({
      templatePath: input.templatePath as string,
      detect: input.detect as boolean | undefined,
      markerColor: input.markerColor as string | undefined,
      qrX: input.qrX as number | undefined,
      qrY: input.qrY as number | undefined,
      qrSize: input.qrSize as number | undefined,
      baseUrl: input.baseUrl as string | undefined,
    });
    emit({ type: 'preview', ...result });
  },

  'generate': async (input, emit) => {
    const config = input.config as PosterConfig;
    if (!config) {
      emit({ type: 'error', message: 'Missing config for generate action' });
      process.exit(1);
    }
    await generatePosters(config, emit as (event: ProgressEvent) => void);
  },
});
