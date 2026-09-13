import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { probeSource } from './probe.js';
import { makeFixture } from './fixtures.js';

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-probe-'));
  file = path.join(dir, 'fixture.mp4');
  await makeFixture({ path: file, durationSec: 10, gopSec: 2 });
}, 60_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('probeSource', () => {
  it('reads duration and stream params', async () => {
    const source = await probeSource(file, 'a');

    expect(source.id).toBe('a');
    expect(source.durationSec).toBeCloseTo(10, 1);
    expect(source.video.codec).toBe('h264');
    expect(source.video.width).toBe(320);
    expect(source.video.height).toBe(240);
    expect(source.video.pixFmt).toBe('yuv420p');
    expect(source.audio.codec).toBe('aac');
    expect(source.audio.sampleRate).toBe(48000);
    expect(source.audio.channels).toBe(2);
  });

  it('reports keyframes every 2 seconds, sorted ascending', async () => {
    const { keyframes } = await probeSource(file, 'a');

    expect(keyframes.length).toBeGreaterThanOrEqual(5);
    expect(keyframes[0]).toBeCloseTo(0, 2);
    expect(keyframes[1]).toBeCloseTo(2, 2);
    expect(keyframes[2]).toBeCloseTo(4, 2);
    expect([...keyframes].sort((x, y) => x - y)).toEqual(keyframes);
  });

  it('fails clearly on a file that is not media', async () => {
    const notMedia = path.join(dir, 'notes.txt');
    await fs.writeFile(notMedia, 'this is not a video');

    await expect(probeSource(notMedia, 'x')).rejects.toThrow();
  });
});
