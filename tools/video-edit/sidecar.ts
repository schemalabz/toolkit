#!/usr/bin/env bun

import path from 'path';
import fs from 'fs/promises';
import { createSidecar } from '../shared/sidecar-harness.js';
import { probeSource } from './probe.js';
import { planExport } from './core.js';
import { executePlan } from './execute.js';
import type { Output } from './types.js';
import { setFfmpegPaths } from './ffmpeg.js';
import { ensureFfmpeg, type EmitFn } from '../shared/binaries.js';

/** The app passes its data directory so downloads land beside the other tools' binaries. */
async function prepare(input: Record<string, unknown>, emit: EmitFn): Promise<void> {
  setFfmpegPaths(await ensureFfmpeg({ dataDir: input.dataDir as string | undefined, emit }));
}

async function sourcesFrom(files: string[], keyframes: boolean) {
  return Promise.all(files.map((file, i) => probeSource(path.resolve(file), `s${i}`, { keyframes })));
}

createSidecar({
  /** Stream parameters and duration for files the user just added, without the keyframe scan. */
  async describe(input, emit) {
    await prepare(input, emit);
    const sources = await sourcesFrom(input.inputs as string[], false);
    emit({ type: 'result', sources });
  },

  async plan(input, emit) {
    await prepare(input, emit);
    const sources = await sourcesFrom(input.inputs as string[], true);
    emit({ type: 'result', plan: planExport(sources, input.outputs as Output[]) });
  },

  async export(input, emit) {
    await prepare(input, emit);
    const sources = await sourcesFrom(input.inputs as string[], true);
    const plan = planExport(sources, input.outputs as Output[]);
    const outDir = path.resolve(input.outDir as string);
    await fs.mkdir(outDir, { recursive: true });
    const files = await executePlan(plan, sources, outDir, (event) => emit(event));
    emit({ type: 'result', files });
  },
});
