import fs from 'fs/promises';
import path from 'path';
import { probeSource } from './probe.js';
import { planExport } from './core.js';
import { executePlan } from './execute.js';
import { verifyOutput } from './verify.js';
import { parseTimestamp, buildOutputsFromFlags } from './spec.js';
import { setFfmpegPaths } from './ffmpeg.js';
import { ensureFfmpeg } from '../shared/binaries.js';
import type { Output, Source } from './types.js';

const USAGE = `video-edit — merge, split and trim recordings without desynchronising them

  video-edit inspect <file>
  video-edit plan   [job options]
  video-edit export [job options]

Job options:
  --input <file>            source file; repeat for several, joined in order
  --remove <from>-<to>      drop a span, e.g. --remove 1:02:03-1:06:15; repeatable
  --split <at>              split into separate files at this point; repeatable
  --out <name>              output base name (default: "output")
  --out-dir <dir>           where to write (default: alongside the first input)
  --json                    machine-readable output
  --deep                    also decode the whole file to prove it is not corrupt
                            (slow: a full pass over a 5-hour recording)

Removal and split positions are measured on the joined timeline — what you would
see watching the inputs back to back. Timestamps accept 90, 1:30, 1:02:03 or
1:02:03.250.

Examples:
  video-edit export --input a.mp4 --input b.mp4 --input c.mp4 --out merged
  video-edit export --input rec.mp4 --remove 1:02:03-1:06:15 --out clean
  video-edit export --input rec.mp4 --split 2:30:00 --out part`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function collectFlag(argv: string[], flag: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === flag && argv[i + 1] !== undefined) values.push(argv[i + 1]);
  });
  return values;
}

function singleFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function loadSources(argv: string[]): Promise<Source[]> {
  const inputs = collectFlag(argv, '--input');
  if (inputs.length === 0) fail('No --input given.\n\n' + USAGE);
  return Promise.all(inputs.map((file, i) => probeSource(path.resolve(file), `s${i}`)));
}

function outputsFrom(argv: string[], sources: Source[]): Output[] {
  const remove = collectFlag(argv, '--remove').map((entry) => {
    // Split on the last '-' so 1:02:03-1:06:15 parses, and reject a missing half.
    const at = entry.lastIndexOf('-');
    if (at <= 0) fail(`--remove expects <from>-<to>, got "${entry}"`);
    return {
      start: parseTimestamp(entry.slice(0, at)),
      end: parseTimestamp(entry.slice(at + 1)),
    };
  });

  for (const gap of remove) {
    if (gap.end <= gap.start) {
      fail(`--remove range ends before it starts: ${gap.start}s to ${gap.end}s`);
    }
  }

  return buildOutputsFromFlags({
    sourceIds: sources.map((s) => s.id),
    durations: sources.map((s) => s.durationSec),
    remove,
    split: collectFlag(argv, '--split').map(parseTimestamp),
    outName: singleFlag(argv, '--out')?.replace(/\.mp4$/, '') ?? 'output',
  });
}

async function runInspect(argv: string[], json: boolean, deep: boolean): Promise<void> {
  const file = argv[1];
  if (!file || file.startsWith('--')) fail('inspect needs a file.\n\n' + USAGE);

  const resolved = path.resolve(file);
  // Keyframes cost ~50s on a long recording and play no part in the verdict.
  const source = await probeSource(resolved, 's0', { keyframes: false });
  const result = await verifyOutput(resolved, source.durationSec, { deepDecode: deep });

  if (json) {
    console.log(JSON.stringify({ source, verification: result }, null, 2));
    return;
  }

  console.log(`duration    : ${source.durationSec.toFixed(3)}s`);
  console.log(`video       : ${source.video.codec} ${source.video.width}x${source.video.height} ` +
    `@ ${source.video.fps} ${source.video.pixFmt}`);
  console.log(`audio       : ${source.audio.codec} ${source.audio.sampleRate}Hz ${source.audio.channels}ch`);
  console.log(`A/V offset  : ${result.avOffsetSec.toFixed(3)}s`);
  console.log(result.ok
    ? 'verdict     : ok'
    : `verdict     : PROBLEMS\n  - ${result.problems.join('\n  - ')}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const json = argv.includes('--json');

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  // Uses a system ffmpeg when there is one, and otherwise downloads into a shared cache, so
  // the packaged binary works on a machine with no ffmpeg installed.
  setFfmpegPaths(await ensureFfmpeg({
    emit: (event) => {
      if (json) return;
      if (event.type === 'status') process.stderr.write(`${event.message}\n`);
      if (event.type === 'download-progress') {
        process.stderr.write(`\r${event.dep} ${event.percent}%   `);
      }
    },
  }));

  if (command === 'inspect') {
    await runInspect(argv, json, argv.includes('--deep'));
    return;
  }

  if (command !== 'plan' && command !== 'export') {
    fail(`Unknown command "${command}".\n\n` + USAGE);
  }

  const sources = await loadSources(argv);
  const outputs = outputsFrom(argv, sources);
  if (outputs.length === 0) fail('That job would produce no video at all — check --remove and --split.');
  const plan = planExport(sources, outputs);

  if (command === 'plan') {
    if (json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    for (const output of plan.outputs) {
      const copied = output.videoPieces.filter((p) => p.kind === 'copy').length;
      const encoded = output.videoPieces.length - copied;
      console.log(`${output.name}.mp4  ${output.expectedDurationSec.toFixed(1)}s  ` +
        `(${copied} copied, ${encoded} re-encoded segment${encoded === 1 ? '' : 's'})`);
    }
    return;
  }

  const outDir = path.resolve(singleFlag(argv, '--out-dir') ?? path.dirname(sources[0].path));
  await fs.mkdir(outDir, { recursive: true });

  const files = await executePlan(plan, sources, outDir, (event) => {
    if (!json) {
      process.stderr.write(`\r${event.output}: ${event.stage} ${event.percent.toFixed(0)}%          `);
    }
  });
  if (!json) process.stderr.write('\n');

  if (json) {
    console.log(JSON.stringify({ files }, null, 2));
  } else {
    for (const file of files) {
      console.log(`${file.path}  ${file.durationSec.toFixed(1)}s  ` +
        `${file.verified ? 'verified' : 'FAILED: ' + file.problems.join('; ')}` +
        `${file.reEncoded ? '  (fell back to full re-encode)' : ''}`);
    }
  }

  if (files.some((f) => !f.verified)) process.exit(1);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
