import { execFile } from 'child_process';
import { promisify } from 'util';

import { ffmpegBin, ffprobeBin } from './ffmpeg.js';

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  durationSec: number;
  /** Largest video-minus-audio start offset across both edit-list views, in seconds. */
  avOffsetSec: number;
}

export interface VerifyOptions {
  /**
   * Decode the whole file to prove it is not corrupt.
   *
   * Off by default: it costs a full decode pass, which on a 5-hour recording takes longer
   * than the export itself and would wipe out the point of smart cutting. The structural
   * checks below are metadata-only, run instantly, and are what catch the desynchronisation
   * this tool exists to prevent. A concat of incompatible pieces also fails loudly in ffmpeg
   * or shows up as a wrong duration, so this pass is a backstop rather than the main net.
   */
  deepDecode?: boolean;
}

/** Duration may differ from the prediction by this much before it counts as wrong. */
const DURATION_TOLERANCE_SEC = 0.5;
/** Video and audio may start this far apart before it counts as desync. */
const AV_TOLERANCE_SEC = 0.2;

async function streamStart(
  filePath: string,
  stream: 'v:0' | 'a:0',
  ignoreEditList: boolean,
): Promise<number> {
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    ...(ignoreEditList ? ['-ignore_editlist', '1'] : []),
    '-select_streams', stream,
    '-show_entries', 'stream=start_time',
    '-of', 'csv=p=0',
    filePath,
  ]);
  const value = parseFloat(stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

/**
 * Checks a produced file against what the plan predicted.
 *
 * The A/V start is measured with the edit list both applied and ignored. An offset hidden
 * behind an edit list reads as perfectly healthy to ffmpeg but desynchronises in players and
 * packagers that skip edit lists — which is exactly how a 4.13s offset reached production
 * unnoticed in orestiada/sep9_2026.
 */
export async function verifyOutput(
  filePath: string,
  expectedDurationSec: number,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const problems: string[] = [];

  const { stdout: durationOut } = await execFileAsync(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ]);
  const durationSec = parseFloat(durationOut.trim());

  if (!Number.isFinite(durationSec)) {
    problems.push('could not read a duration from the output file');
  } else if (Math.abs(durationSec - expectedDurationSec) > DURATION_TOLERANCE_SEC) {
    problems.push(
      `duration is ${durationSec.toFixed(3)}s but the plan predicted ${expectedDurationSec.toFixed(3)}s`);
  }

  const [videoApplied, audioApplied, videoRaw, audioRaw] = await Promise.all([
    streamStart(filePath, 'v:0', false),
    streamStart(filePath, 'a:0', false),
    streamStart(filePath, 'v:0', true),
    streamStart(filePath, 'a:0', true),
  ]);
  const offsetApplied = videoApplied - audioApplied;
  const offsetRaw = videoRaw - audioRaw;
  const avOffsetSec = Math.abs(offsetApplied) >= Math.abs(offsetRaw) ? offsetApplied : offsetRaw;

  if (Math.abs(offsetApplied) > AV_TOLERANCE_SEC) {
    problems.push(`video starts ${offsetApplied.toFixed(3)}s from audio`);
  }
  if (Math.abs(offsetRaw) > AV_TOLERANCE_SEC) {
    problems.push(
      `video starts ${offsetRaw.toFixed(3)}s from audio once the edit list is ignored ` +
      `(players and packagers that skip edit lists will be out of sync)`);
  }

  if (opts.deepDecode) {
    try {
      await execFileAsync(ffmpegBin(), ['-v', 'error', '-xerror', '-i', filePath, '-f', 'null', '-'],
        { maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
      problems.push(`the file does not decode cleanly: ${detail}`);
    }
  }

  return { ok: problems.length === 0, problems, durationSec, avOffsetSec };
}
