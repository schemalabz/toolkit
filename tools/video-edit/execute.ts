import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import type { ExportPlan, OutputPlan, Source, Piece } from './types.js';
import { verifyOutput } from './verify.js';
import { ffmpegBin } from './ffmpeg.js';

const execFileAsync = promisify(execFile);
const BIG_BUFFER = { maxBuffer: 32 * 1024 * 1024 };

export type ProgressEvent = {
  type: 'progress';
  output: string;
  stage: string;
  percent: number;
};

export interface ExportedFile {
  name: string;
  path: string;
  durationSec: number;
  verified: boolean;
  problems: string[];
  /** True when smart cut was discarded and the output was fully re-encoded instead. */
  reEncoded: boolean;
}

const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
const AUDIO_ENCODE = ['-c:a', 'aac', '-b:a', '160k'];

/**
 * Input-side seeking, always.
 *
 * `-ss` placed after `-i` with `-c copy` is what desynchronises files — it is the defect
 * this tool replaces, so it must never appear here.
 */
function seekArgs(start: number, end: number): string[] {
  return ['-ss', start.toFixed(3), '-t', (end - start).toFixed(3)];
}

async function buildVideoPiece(
  piece: Piece,
  source: Source,
  outPath: string,
  matchTo: Source,
): Promise<void> {
  const codec = piece.kind === 'copy'
    ? ['-c:v', 'copy']
    : [...VIDEO_ENCODE, '-pix_fmt', matchTo.video.pixFmt, '-r', matchTo.video.fps];

  await execFileAsync(ffmpegBin(), [
    '-y', '-loglevel', 'error',
    ...seekArgs(piece.start, piece.end), '-i', source.path,
    '-an', ...codec, outPath,
  ], BIG_BUFFER);
}

/**
 * One continuous audio pass over every range.
 *
 * Audio is never stream-copied or concatenated pre-encoded: joining encoded AAC is where
 * encoder priming and padding accumulate into drift. `aresample=async=1:first_pts=0` pins
 * output samples to input timestamps so gaps cannot creep in.
 */
async function buildAudio(
  output: OutputPlan,
  byId: Map<string, Source>,
  outPath: string,
): Promise<void> {
  const inputs: string[] = [];
  const filters: string[] = [];

  output.audioRanges.forEach((range, index) => {
    const source = byId.get(range.sourceId)!;
    inputs.push(...seekArgs(range.start, range.end), '-i', source.path);
    filters.push(`[${index}:a]aresample=async=1:first_pts=0[a${index}]`);
  });

  const labels = output.audioRanges.map((_, i) => `[a${i}]`).join('');
  const graph = `${filters.join(';')};${labels}concat=n=${output.audioRanges.length}:v=0:a=1[out]`;

  await execFileAsync(ffmpegBin(), [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', graph, '-map', '[out]', ...AUDIO_ENCODE, outPath,
  ], BIG_BUFFER);
}

/** The slow, safe path: decode everything and re-encode in one pass. */
async function fullReEncode(
  output: OutputPlan,
  byId: Map<string, Source>,
  outPath: string,
): Promise<void> {
  const inputs: string[] = [];
  const filters: string[] = [];

  output.audioRanges.forEach((range, index) => {
    const source = byId.get(range.sourceId)!;
    inputs.push(...seekArgs(range.start, range.end), '-i', source.path);
    filters.push(
      `[${index}:v]setpts=PTS-STARTPTS[v${index}];` +
      `[${index}:a]aresample=async=1:first_pts=0[a${index}]`);
  });

  const labels = output.audioRanges.map((_, i) => `[v${i}][a${i}]`).join('');
  const graph = `${filters.join(';')};${labels}concat=n=${output.audioRanges.length}:v=1:a=1[v][a]`;

  await execFileAsync(ffmpegBin(), [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    ...VIDEO_ENCODE, ...AUDIO_ENCODE, '-movflags', '+faststart', outPath,
  ], BIG_BUFFER);
}

async function buildOutput(
  output: OutputPlan,
  byId: Map<string, Source>,
  outDir: string,
  onProgress?: (e: ProgressEvent) => void,
): Promise<ExportedFile> {
  const emit = (stage: string, percent: number) =>
    onProgress?.({ type: 'progress', output: output.name, stage, percent });

  const work = await fs.mkdtemp(path.join(outDir, `.${output.name}-`));
  const finalPath = path.join(outDir, `${output.name}.mp4`);
  const matchTo = byId.get(output.videoPieces[0].sourceId)!;

  try {
    emit('video', 0);
    const piecePaths: string[] = [];
    for (const [index, piece] of output.videoPieces.entries()) {
      const piecePath = path.join(work, `v${String(index).padStart(4, '0')}.mp4`);
      await buildVideoPiece(piece, byId.get(piece.sourceId)!, piecePath, matchTo);
      piecePaths.push(piecePath);
      emit('video', ((index + 1) / output.videoPieces.length) * 100);
    }

    const listPath = path.join(work, 'pieces.txt');
    await fs.writeFile(listPath, piecePaths.map((p) => `file '${p}'`).join('\n'));
    const videoPath = path.join(work, 'video.mp4');
    await execFileAsync(ffmpegBin(), [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
      '-i', listPath, '-c', 'copy', videoPath,
    ], BIG_BUFFER);

    emit('audio', 0);
    const audioPath = path.join(work, 'audio.m4a');
    await buildAudio(output, byId, audioPath);
    emit('audio', 100);

    emit('muxing', 0);
    await execFileAsync(ffmpegBin(), [
      '-y', '-loglevel', 'error', '-i', videoPath, '-i', audioPath,
      '-c', 'copy', '-movflags', '+faststart', '-shortest', finalPath,
    ], BIG_BUFFER);

    emit('verifying', 0);
    let result = await verifyOutput(finalPath, output.expectedDurationSec);
    let reEncoded = false;

    if (!result.ok) {
      // Smart cut produced something wrong. Discard it and take the slow, safe path
      // rather than hand back a file that looks finished and plays wrong.
      emit('re-encoding', 0);
      await fullReEncode(output, byId, finalPath);
      result = await verifyOutput(finalPath, output.expectedDurationSec);
      reEncoded = true;
    }

    emit('done', 100);
    return {
      name: output.name,
      path: finalPath,
      durationSec: result.durationSec,
      verified: result.ok,
      problems: result.problems,
      reEncoded,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function executePlan(
  plan: ExportPlan,
  sources: Source[],
  outDir: string,
  onProgress?: (e: ProgressEvent) => void,
): Promise<ExportedFile[]> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const files: ExportedFile[] = [];
  for (const output of plan.outputs) {
    files.push(await buildOutput(output, byId, outDir, onProgress));
  }
  return files;
}
