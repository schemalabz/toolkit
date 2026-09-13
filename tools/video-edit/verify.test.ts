import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { verifyOutput } from './verify.js';
import { makeFixture } from './fixtures.js';

const execFileAsync = promisify(execFile);

let dir: string;
let good: string;
let desynced: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-verify-'));
  good = path.join(dir, 'good.mp4');
  desynced = path.join(dir, 'desynced.mp4');
  await makeFixture({ path: good, durationSec: 20, gopSec: 2 });

  // Exactly what video-cutter does today: output-side -ss with stream copy, plus
  // -avoid_negative_ts make_zero. This is the defect the tool exists to replace.
  await execFileAsync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', good,
    '-ss', '7', '-t', '5', '-c', 'copy', '-avoid_negative_ts', 'make_zero', desynced,
  ]);
}, 120_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('verifyOutput', () => {
  it('passes a well-formed file whose duration matches the prediction', async () => {
    const result = await verifyOutput(good, 20);

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(Math.abs(result.avOffsetSec)).toBeLessThan(0.2);
  });

  it('still passes a good file under the slow deep decode', async () => {
    const result = await verifyOutput(good, 20, { deepDecode: true });

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  }, 60_000);

  it('fails when the duration does not match the prediction', async () => {
    const result = await verifyOutput(good, 45);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/duration/i);
  });

  it('catches the desync video-cutter produces', async () => {
    const result = await verifyOutput(desynced, 5);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/starts .* from audio/);
    // Not a rounding artefact. The magnitude tracks the GOP length, so it is ~1s for this
    // 2s-GOP fixture and was 6.9s on the real recording that prompted this tool.
    expect(Math.abs(result.avOffsetSec)).toBeGreaterThan(0.5);
  });
});
