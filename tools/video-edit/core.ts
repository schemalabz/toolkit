import type { Source, Output, ExportPlan, OutputPlan, Piece, Clip } from './types.js';

/** Boundaries within this many seconds of a keyframe count as landing on it. */
export const EPSILON = 0.001;

/**
 * Splits one clip into stream-copyable and re-encodable video pieces.
 *
 * Only a boundary that falls inside a GOP needs re-encoding. A boundary on a keyframe is
 * already exact, and so is the end of the source — the final GOP runs to EOF, so copying
 * up to it loses nothing.
 */
function planClipVideo(source: Source, clip: Clip): Piece[] {
  const piece = (start: number, end: number, kind: Piece['kind']): Piece =>
    ({ sourceId: clip.sourceId, start, end, kind });

  const atSourceEnd = clip.end >= source.durationSec - EPSILON;

  const firstKf = source.keyframes.find((k) => k >= clip.start - EPSILON);
  const before = source.keyframes.filter((k) => k <= clip.end + EPSILON);
  const lastKf = atSourceEnd
    ? clip.end
    : (before.length > 0 ? before[before.length - 1] : undefined);

  // Nothing copyable in between: re-encode the whole clip.
  if (firstKf === undefined || lastKf === undefined || lastKf - firstKf < EPSILON) {
    return [piece(clip.start, clip.end, 'encode')];
  }

  const pieces: Piece[] = [];
  if (firstKf - clip.start > EPSILON) pieces.push(piece(clip.start, firstKf, 'encode'));
  pieces.push(piece(firstKf, lastKf, 'copy'));
  if (clip.end - lastKf > EPSILON) pieces.push(piece(lastKf, clip.end, 'encode'));
  return pieces;
}

/**
 * Refuses sources that cannot be joined by stream copy.
 *
 * The spec's position is that recordings always match because they come from one capture
 * setup. This checks rather than assumes: silently concatenating mismatched streams yields
 * a file that looks fine and plays wrong.
 */
export function assertSourcesCompatible(sources: Source[]): void {
  if (sources.length < 2) return;
  const [first, ...rest] = sources;
  const name = (s: Source) => s.path.split('/').pop() ?? s.path;

  for (const other of rest) {
    const differences: string[] = [];
    if (other.video.width !== first.video.width || other.video.height !== first.video.height) {
      differences.push(
        `resolution (${name(other)} is ${other.video.width}x${other.video.height}, ` +
        `${name(first)} is ${first.video.width}x${first.video.height})`);
    }
    if (other.video.codec !== first.video.codec) {
      differences.push(`video codec (${name(other)} is ${other.video.codec}, ${name(first)} is ${first.video.codec})`);
    }
    if (other.video.fps !== first.video.fps) {
      differences.push(`frame rate (${name(other)} is ${other.video.fps}, ${name(first)} is ${first.video.fps})`);
    }
    if (other.video.pixFmt !== first.video.pixFmt) {
      differences.push(`pixel format (${name(other)} is ${other.video.pixFmt}, ${name(first)} is ${first.video.pixFmt})`);
    }
    if (other.audio.sampleRate !== first.audio.sampleRate) {
      differences.push(
        `audio sample rate (${name(other)} is ${other.audio.sampleRate}Hz, ` +
        `${name(first)} is ${first.audio.sampleRate}Hz)`);
    }
    if (other.audio.channels !== first.audio.channels) {
      differences.push(
        `audio channels (${name(other)} has ${other.audio.channels}, ${name(first)} has ${first.audio.channels})`);
    }
    if (differences.length > 0) {
      throw new Error(
        `These recordings cannot be joined because they do not match:\n  ` +
        differences.join('\n  ') +
        `\nRe-encode them to a common format first.`);
    }
  }
}

/**
 * Turns sources and desired outputs into an executable plan.
 *
 * Pure: performs no I/O and spawns nothing, so every branch is unit-testable.
 */
export function planExport(sources: Source[], outputs: Output[]): ExportPlan {
  assertSourcesCompatible(sources);

  const byId = new Map(sources.map((s) => [s.id, s]));

  const planned: OutputPlan[] = outputs.map((output) => {
    const videoPieces: Piece[] = [];
    for (const clip of output.clips) {
      const source = byId.get(clip.sourceId);
      if (!source) {
        throw new Error(`Output "${output.name}" references unknown source "${clip.sourceId}"`);
      }
      videoPieces.push(...planClipVideo(source, clip));
    }
    return {
      name: output.name,
      videoPieces,
      audioRanges: output.clips.map((c) => ({ ...c })),
      expectedDurationSec: output.clips.reduce((total, c) => total + (c.end - c.start), 0),
    };
  });

  return { outputs: planned };
}
