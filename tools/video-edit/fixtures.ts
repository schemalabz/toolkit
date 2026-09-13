import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Generates a small test video with a known, regular GOP length.
 *
 * `-sc_threshold 0` with a fixed `-g`/`-keyint_min` keeps keyframes exactly `gopSec` apart,
 * so tests can assert which boundaries need re-encoding.
 */
export async function makeFixture(opts: {
  path: string;
  durationSec: number;
  gopSec?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  const { path, durationSec, gopSec = 2, width = 320, height = 240 } = opts;
  const fps = 30;
  await execFileAsync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-g', String(gopSec * fps), '-keyint_min', String(gopSec * fps), '-sc_threshold', '0',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000',
    '-shortest', path,
  ]);
}
