import type { FfmpegPaths } from '../shared/binaries.js';

/**
 * Which ffmpeg and ffprobe this process runs.
 *
 * Held here rather than threaded through probe, execute and verify: every one of them needs
 * both binaries, and passing a pair of paths down four call layers buys nothing over setting
 * it once at start-up.
 *
 * The default is whatever is on PATH, which keeps tests and the Nix dev shell working with no
 * setup. Entry points that must run on a machine without ffmpeg — the packaged CLI, the app
 * sidecar — call `setFfmpegPaths(await ensureFfmpeg(...))` before doing any work.
 */
let paths: FfmpegPaths = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };

export function setFfmpegPaths(resolved: FfmpegPaths): void {
  paths = resolved;
}

export function ffmpegBin(): string {
  return paths.ffmpegPath;
}

export function ffprobeBin(): string {
  return paths.ffprobePath;
}
