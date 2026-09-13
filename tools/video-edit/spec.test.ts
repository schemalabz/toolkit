import { describe, it, expect } from 'vitest';
import { parseTimestamp, buildOutputsFromFlags } from './spec.js';

describe('parseTimestamp', () => {
  it('accepts seconds, mm:ss, hh:mm:ss and fractional seconds', () => {
    expect(parseTimestamp('90')).toBe(90);
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('1:02:03.250')).toBeCloseTo(3723.25, 3);
  });

  it('rejects nonsense with a message naming the value', () => {
    expect(() => parseTimestamp('banana')).toThrow(/banana/);
    expect(() => parseTimestamp('1:2:3:4')).toThrow(/1:2:3:4/);
    expect(() => parseTimestamp('')).toThrow();
  });
});

describe('buildOutputsFromFlags', () => {
  it('joins several inputs into one output', () => {
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a', 'b'], durations: [10, 8], remove: [], split: [], outName: 'merged',
    });

    expect(outputs).toEqual([{
      name: 'merged',
      clips: [{ sourceId: 'a', start: 0, end: 10 }, { sourceId: 'b', start: 0, end: 8 }],
    }]);
  });

  it('turns a removal into two clips around the gap', () => {
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a'], durations: [100], remove: [{ start: 30, end: 40 }], split: [], outName: 'clean',
    });

    expect(outputs[0].clips).toEqual([
      { sourceId: 'a', start: 0, end: 30 },
      { sourceId: 'a', start: 40, end: 100 },
    ]);
  });

  it('turns a split into two outputs', () => {
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a'], durations: [100], remove: [], split: [60], outName: 'part',
    });

    expect(outputs.map((o) => o.name)).toEqual(['part1', 'part2']);
    expect(outputs[0].clips).toEqual([{ sourceId: 'a', start: 0, end: 60 }]);
    expect(outputs[1].clips).toEqual([{ sourceId: 'a', start: 60, end: 100 }]);
  });

  it('maps a removal that spans a source boundary onto both sources', () => {
    // Joined timeline is a:[0,10) then b:[10,20). Removing 8-12 clips the tail of a
    // and the head of b.
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a', 'b'], durations: [10, 10],
      remove: [{ start: 8, end: 12 }], split: [], outName: 'o',
    });

    expect(outputs[0].clips).toEqual([
      { sourceId: 'a', start: 0, end: 8 },
      { sourceId: 'b', start: 2, end: 10 },
    ]);
  });

  it('combines a merge, a removal and a split in one pass', () => {
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a', 'b'], durations: [10, 10],
      remove: [{ start: 3, end: 5 }], split: [12], outName: 'out',
    });

    expect(outputs.map((o) => o.name)).toEqual(['out1', 'out2']);
    expect(outputs[0].clips).toEqual([
      { sourceId: 'a', start: 0, end: 3 },
      { sourceId: 'a', start: 5, end: 10 },
      { sourceId: 'b', start: 0, end: 2 },
    ]);
    expect(outputs[1].clips).toEqual([{ sourceId: 'b', start: 2, end: 10 }]);
  });

  it('drops a part left empty by a removal rather than emitting a zero-length file', () => {
    const outputs = buildOutputsFromFlags({
      sourceIds: ['a'], durations: [100],
      remove: [{ start: 0, end: 50 }], split: [50], outName: 'p',
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0].clips).toEqual([{ sourceId: 'a', start: 50, end: 100 }]);
  });
});
