import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { makeFixture } from './fixtures.js';

/**
 * The design's safety claim is that no path produces a bad file and calls it done: if
 * verification fails, the output is discarded and re-exported with a full re-encode.
 *
 * Smart cut has never failed on real footage, so that branch would otherwise ship untested —
 * and an untested fallback is not a guarantee, it is a hope. Here verification is forced to
 * reject the smart-cut result once, so the recovery path actually runs.
 */
const verifyOutput = vi.hoisted(() => vi.fn());
vi.mock('./verify.js', () => ({ verifyOutput }));

const { executePlan } = await import('./execute.js');
const { planExport } = await import('./core.js');
const { probeSource } = await import('./probe.js');

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-fallback-'));
  await makeFixture({ path: path.join(dir, 'src.mp4'), durationSec: 12, gopSec: 2 });
}, 120_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('verification failure', () => {
  it('discards the smart-cut result and re-exports with a full re-encode', async () => {
    const source = await probeSource(path.join(dir, 'src.mp4'), 's');
    const plan = planExport([source], [{
      name: 'out',
      clips: [{ sourceId: 's', start: 1, end: 9 }],
    }]);

    verifyOutput
      .mockResolvedValueOnce({
        ok: false,
        problems: ['video starts 3.000s from audio'],
        durationSec: 8,
        avOffsetSec: 3,
      })
      .mockResolvedValueOnce({ ok: true, problems: [], durationSec: 8, avOffsetSec: 0.03 });

    const [file] = await executePlan(plan, [source], dir);

    expect(verifyOutput).toHaveBeenCalledTimes(2);
    expect(file.reEncoded).toBe(true);
    expect(file.verified).toBe(true);
    expect(file.problems).toEqual([]);

    // The recovery must have produced a real file, not just flipped a flag.
    const written = await fs.stat(file.path);
    expect(written.size).toBeGreaterThan(0);
  }, 180_000);

  it('reports the problems when even the re-encode cannot be verified', async () => {
    const source = await probeSource(path.join(dir, 'src.mp4'), 's');
    const plan = planExport([source], [{
      name: 'hopeless',
      clips: [{ sourceId: 's', start: 0, end: 6 }],
    }]);

    verifyOutput.mockResolvedValue({
      ok: false,
      problems: ['duration is 1.000s but the plan predicted 6.000s'],
      durationSec: 1,
      avOffsetSec: 0,
    });

    const [file] = await executePlan(plan, [source], dir);

    expect(file.reEncoded).toBe(true);
    expect(file.verified).toBe(false);
    expect(file.problems.join(' ')).toMatch(/duration/);
  }, 180_000);
});
