import { describe, it, expect } from 'vitest';
import { planExport } from './core.js';
import type { Source, Output } from './types.js';

/** A source with keyframes every 2s, as our recordings have. */
function src(id: string, durationSec: number): Source {
  const keyframes: number[] = [];
  for (let t = 0; t < durationSec; t += 2) keyframes.push(t);
  return {
    id,
    path: `/tmp/${id}.mp4`,
    durationSec,
    keyframes,
    video: { codec: 'h264', width: 1280, height: 720, fps: '30/1', pixFmt: 'yuv420p' },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
  };
}

describe('planExport - merge whole sources', () => {
  it('copies each source whole and never re-encodes video', () => {
    const sources = [src('a', 100), src('b', 60), src('c', 40)];
    const outputs: Output[] = [{
      name: 'merged',
      clips: [
        { sourceId: 'a', start: 0, end: 100 },
        { sourceId: 'b', start: 0, end: 60 },
        { sourceId: 'c', start: 0, end: 40 },
      ],
    }];

    const plan = planExport(sources, outputs);

    expect(plan.outputs).toHaveLength(1);
    const out = plan.outputs[0];
    expect(out.videoPieces.map((p) => p.kind)).toEqual(['copy', 'copy', 'copy']);
    expect(out.videoPieces.map((p) => p.sourceId)).toEqual(['a', 'b', 'c']);
    expect(out.expectedDurationSec).toBe(200);
  });

  it('carries the clip ranges through to audio untouched', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{ name: 'o', clips: [{ sourceId: 'a', start: 10, end: 30 }] }];

    const plan = planExport(sources, outputs);

    expect(plan.outputs[0].audioRanges).toEqual([{ sourceId: 'a', start: 10, end: 30 }]);
  });

  it('rejects an output referencing an unknown source', () => {
    expect(() => planExport([src('a', 10)], [{ name: 'o', clips: [{ sourceId: 'z', start: 0, end: 5 }] }]))
      .toThrow(/unknown source "z"/);
  });
});

describe('planExport - edge splitting', () => {
  it('re-encodes the partial GOP at each end and copies the middle', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{ name: 'o', clips: [{ sourceId: 'a', start: 5, end: 15 }] }];

    const pieces = planExport(sources, outputs).outputs[0].videoPieces;

    expect(pieces).toEqual([
      { sourceId: 'a', start: 5, end: 6, kind: 'encode' },
      { sourceId: 'a', start: 6, end: 14, kind: 'copy' },
      { sourceId: 'a', start: 14, end: 15, kind: 'encode' },
    ]);
  });

  it('emits no edge piece when a boundary already lands on a keyframe', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{ name: 'o', clips: [{ sourceId: 'a', start: 6, end: 14 }] }];

    const pieces = planExport(sources, outputs).outputs[0].videoPieces;

    expect(pieces).toEqual([{ sourceId: 'a', start: 6, end: 14, kind: 'copy' }]);
  });

  it('re-encodes a clip shorter than one GOP whole', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{ name: 'o', clips: [{ sourceId: 'a', start: 5.2, end: 5.9 }] }];

    const pieces = planExport(sources, outputs).outputs[0].videoPieces;

    expect(pieces).toEqual([{ sourceId: 'a', start: 5.2, end: 5.9, kind: 'encode' }]);
  });

  it('splits an ad removal into two clips that keep their own edges', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{
      name: 'o',
      clips: [
        { sourceId: 'a', start: 0, end: 11 },
        { sourceId: 'a', start: 23, end: 40 },
      ],
    }];

    const out = planExport(sources, outputs).outputs[0];

    expect(out.videoPieces).toEqual([
      { sourceId: 'a', start: 0, end: 10, kind: 'copy' },
      { sourceId: 'a', start: 10, end: 11, kind: 'encode' },
      { sourceId: 'a', start: 23, end: 24, kind: 'encode' },
      { sourceId: 'a', start: 24, end: 40, kind: 'copy' },
    ]);
    expect(out.expectedDurationSec).toBe(28);
  });

  it('never loses or duplicates time: pieces tile the clip exactly', () => {
    const sources = [src('a', 100)];
    const outputs: Output[] = [{ name: 'o', clips: [{ sourceId: 'a', start: 5, end: 15 }] }];

    const pieces = planExport(sources, outputs).outputs[0].videoPieces;

    expect(pieces[0].start).toBe(5);
    expect(pieces[pieces.length - 1].end).toBe(15);
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].start).toBe(pieces[i - 1].end);
    }
  });
});

describe('planExport - source compatibility', () => {
  it('names the files and the field when video params differ', () => {
    const a = src('a', 10);
    const b = src('b', 10);
    b.video.width = 1920;
    b.video.height = 1080;

    expect(() => planExport([a, b], [{
      name: 'o',
      clips: [{ sourceId: 'a', start: 0, end: 10 }, { sourceId: 'b', start: 0, end: 10 }],
    }])).toThrow(/b\.mp4.*1920x1080.*a\.mp4.*1280x720/s);
  });

  it('names the field when audio sample rates differ', () => {
    const a = src('a', 10);
    const b = src('b', 10);
    b.audio.sampleRate = 96000;

    expect(() => planExport([a, b], [{
      name: 'o',
      clips: [{ sourceId: 'a', start: 0, end: 10 }, { sourceId: 'b', start: 0, end: 10 }],
    }])).toThrow(/sample rate/i);
  });

  it('accepts a single source', () => {
    expect(() => planExport([src('a', 10)], [{ name: 'o', clips: [{ sourceId: 'a', start: 0, end: 10 }] }]))
      .not.toThrow();
  });
});
