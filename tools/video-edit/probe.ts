import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Source } from './types.js';
import { ffprobeBin } from './ffmpeg.js';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
}

export interface ProbeOptions {
  /**
   * Read keyframe positions. Required for planning, pointless for anything that only wants
   * stream parameters: scanning a 5-hour recording takes ~50s even demuxing-only.
   */
  keyframes?: boolean;
}

/** Reads everything the planner needs from one file: stream params, duration, keyframes. */
export async function probeSource(
  filePath: string,
  id: string,
  opts: ProbeOptions = {},
): Promise<Source> {
  const { keyframes = true } = opts;
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ], { maxBuffer: 32 * 1024 * 1024 });

  const parsed = JSON.parse(stdout) as { streams: FfprobeStream[]; format: { duration: string } };
  const video = parsed.streams.find((s) => s.codec_type === 'video');
  const audio = parsed.streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error(`${filePath} has no video stream`);
  if (!audio) throw new Error(`${filePath} has no audio stream`);

  const durationSec = parseFloat(parsed.format.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Could not read a duration from ${filePath}`);
  }

  return {
    id,
    path: filePath,
    durationSec,
    keyframes: keyframes ? await readKeyframes(filePath) : [],
    video: {
      codec: video.codec_name,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: video.r_frame_rate ?? '0/0',
      pixFmt: video.pix_fmt ?? '',
    },
    audio: {
      codec: audio.codec_name,
      sampleRate: parseInt(audio.sample_rate ?? '0', 10),
      channels: audio.channels ?? 0,
    },
  };
}

/**
 * Keyframe presentation times, ascending.
 *
 * Read from packet flags rather than `-skip_frame nokey`: packets only need demuxing, while
 * the frame form decodes headers for every frame in the file. On a 5h41m recording that is
 * the difference between ~50 seconds and over ten minutes.
 *
 * A recording that long holds ~10k keyframes, hence the large buffer.
 */
async function readKeyframes(filePath: string): Promise<number[]> {
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,flags',
    '-of', 'csv=p=0',
    filePath,
  ], { maxBuffer: 256 * 1024 * 1024 });

  const times: number[] = [];
  for (const line of stdout.split('\n')) {
    const [time, flags] = line.split(',');
    if (!flags || !flags.startsWith('K')) continue;
    const value = parseFloat(time);
    if (Number.isFinite(value)) times.push(value);
  }
  return times.sort((a, b) => a - b);
}
