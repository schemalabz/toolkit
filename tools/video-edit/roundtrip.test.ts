import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { executePlan } from './execute.js';
import { planExport } from './core.js';
import { probeSource } from './probe.js';
import { verifyOutput } from './verify.js';
import { makeFixture } from './fixtures.js';

/**
 * Splitting a recording and merging the parts back must be an identity operation on the
 * timeline. This is the shape of the failure that prompted the tool: three recordings merged
 * by hand drifted 1.4s against their own transcript, with the drift stepping at each join.
 *
 * Verified separately against a real 12-minute 96kHz excerpt, where silence onsets past two
 * join points matched the original to within 10 microseconds. This fixture version guards the
 * property on every run.
 */
let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-roundtrip-'));
  await makeFixture({ path: path.join(dir, 'original.mp4'), durationSec: 24, gopSec: 2 });
}, 120_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('split then merge', () => {
  it('returns to the original duration with the streams still aligned', async () => {
    const original = await probeSource(path.join(dir, 'original.mp4'), 'o');

    // Split at points that deliberately fall inside a GOP, so each part has re-encoded
    // edges — the joins a pure stream copy would never exercise.
    const splitPlan = planExport([original], [
      { name: 'p1', clips: [{ sourceId: 'o', start: 0, end: 7 }] },
      { name: 'p2', clips: [{ sourceId: 'o', start: 7, end: 15 }] },
      { name: 'p3', clips: [{ sourceId: 'o', start: 15, end: original.durationSec }] },
    ]);
    const parts = await executePlan(splitPlan, [original], dir);
    expect(parts.every((p) => p.verified)).toBe(true);

    const sources = await Promise.all(
      parts.map((part, i) => probeSource(part.path, `s${i}`)),
    );
    const mergePlan = planExport(sources, [{
      name: 'merged',
      clips: sources.map((s) => ({ sourceId: s.id, start: 0, end: s.durationSec })),
    }]);
    const [merged] = await executePlan(mergePlan, sources, dir);

    expect(merged.problems).toEqual([]);
    expect(merged.verified).toBe(true);
    // A fallback here would mean smart cut cannot survive its own output.
    expect(merged.reEncoded).toBe(false);
    expect(merged.durationSec).toBeCloseTo(original.durationSec, 0);

    // The check that matters: no offset accumulated at either join.
    const result = await verifyOutput(merged.path, original.durationSec);
    expect(Math.abs(result.avOffsetSec)).toBeLessThan(0.2);
  }, 240_000);
});
