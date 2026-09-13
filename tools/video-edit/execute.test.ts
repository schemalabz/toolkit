import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { executePlan } from './execute.js';
import { planExport } from './core.js';
import { probeSource } from './probe.js';
import { makeFixture } from './fixtures.js';
import type { Source } from './types.js';

let dir: string;
let a: Source;
let b: Source;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-exec-'));
  const fileA = path.join(dir, 'a.mp4');
  const fileB = path.join(dir, 'b.mp4');
  await makeFixture({ path: fileA, durationSec: 20, gopSec: 2 });
  await makeFixture({ path: fileB, durationSec: 12, gopSec: 2 });
  a = await probeSource(fileA, 'a');
  b = await probeSource(fileB, 'b');
}, 180_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('executePlan', () => {
  it('merges two sources into one verified file', async () => {
    const plan = planExport([a, b], [{
      name: 'merged',
      clips: [
        { sourceId: 'a', start: 0, end: a.durationSec },
        { sourceId: 'b', start: 0, end: b.durationSec },
      ],
    }]);

    const [file] = await executePlan(plan, [a, b], dir);

    expect(file.problems).toEqual([]);
    expect(file.verified).toBe(true);
    // Smart cut must have carried this itself; a silent fallback would hide a broken engine.
    expect(file.reEncoded).toBe(false);
    expect(file.durationSec).toBeCloseTo(a.durationSec + b.durationSec, 0);
  }, 180_000);

  it('removes an interior range, keeping the surrounding content', async () => {
    const plan = planExport([a], [{
      name: 'trimmed',
      clips: [
        { sourceId: 'a', start: 0, end: 5 },
        { sourceId: 'a', start: 13, end: a.durationSec },
      ],
    }]);

    const [file] = await executePlan(plan, [a], dir);

    expect(file.problems).toEqual([]);
    expect(file.verified).toBe(true);
    expect(file.reEncoded).toBe(false);
    expect(file.durationSec).toBeCloseTo(5 + (a.durationSec - 13), 0);
  }, 180_000);

  it('produces one verified file per output when splitting', async () => {
    const plan = planExport([a], [
      { name: 'part1', clips: [{ sourceId: 'a', start: 0, end: 7 }] },
      { name: 'part2', clips: [{ sourceId: 'a', start: 7, end: a.durationSec }] },
    ]);

    const files = await executePlan(plan, [a], dir);

    expect(files.map((f) => f.name)).toEqual(['part1', 'part2']);
    expect(files.every((f) => f.verified)).toBe(true);
    expect(files.every((f) => !f.reEncoded)).toBe(true);
    expect(files[0].durationSec + files[1].durationSec).toBeCloseTo(a.durationSec, 0);
  }, 240_000);

  it('leaves no temporary working directories behind', async () => {
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.startsWith('.'))).toEqual([]);
  });
});
