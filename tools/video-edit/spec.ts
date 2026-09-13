import type { Output, Clip } from './types.js';

/** Accepts `90`, `1:30`, `1:02:03` or `1:02:03.250`. */
export function parseTimestamp(text: string): number {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3) throw new Error(`Not a timestamp: "${text}"`);

  let seconds = 0;
  for (const part of parts) {
    if (part.trim() === '') throw new Error(`Not a timestamp: "${text}"`);
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Not a timestamp: "${text}"`);
    seconds = seconds * 60 + value;
  }
  return seconds;
}

export interface FlagOptions {
  sourceIds: string[];
  durations: number[];
  remove: { start: number; end: number }[];
  split: number[];
  outName: string;
}

/**
 * Turns the shorthand flags into outputs.
 *
 * The sources are laid end to end on one joined timeline; removals punch holes in it and
 * splits divide it into separate outputs. Removal and split positions are therefore given
 * in joined-timeline coordinates, which is what someone watching the merged result sees.
 */
export function buildOutputsFromFlags(opts: FlagOptions): Output[] {
  const { sourceIds, durations, remove, split, outName } = opts;

  const offsets: number[] = [];
  let running = 0;
  for (const duration of durations) {
    offsets.push(running);
    running += duration;
  }
  const total = running;

  /** Maps a span of the joined timeline back onto the sources it covers. */
  const toClips = (from: number, to: number): Clip[] => {
    const result: Clip[] = [];
    sourceIds.forEach((sourceId, i) => {
      const sourceStart = offsets[i];
      const sourceEnd = sourceStart + durations[i];
      const overlapStart = Math.max(from, sourceStart);
      const overlapEnd = Math.min(to, sourceEnd);
      if (overlapEnd - overlapStart > 0.0005) {
        result.push({
          sourceId,
          start: overlapStart - sourceStart,
          end: overlapEnd - sourceStart,
        });
      }
    });
    return result;
  };

  // The spans that survive the removals.
  const kept: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const gap of [...remove].sort((x, y) => x.start - y.start)) {
    if (gap.start > cursor) kept.push({ from: cursor, to: gap.start });
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < total) kept.push({ from: cursor, to: total });

  const boundaries = [0, ...[...split].sort((x, y) => x - y), total];
  const outputs: Output[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const partFrom = boundaries[i];
    const partTo = boundaries[i + 1];
    const partClips: Clip[] = [];

    for (const span of kept) {
      const from = Math.max(span.from, partFrom);
      const to = Math.min(span.to, partTo);
      if (to - from > 0.0005) partClips.push(...toClips(from, to));
    }

    if (partClips.length === 0) continue;
    outputs.push({
      name: split.length === 0 ? outName : `${outName}${outputs.length + 1}`,
      clips: partClips,
    });
  }

  return outputs;
}
