# video-edit — design

**Date:** 2026-09-11
**Status:** approved, not yet implemented

## Why

The operations team merges, splits and trims council recordings before uploading them.
They do this with `video-cutter`, a standalone Electron app, and by hand for merges.

`video-cutter` produces desynchronised output. Its `cutVideo` passes `-ss` as an *output*
option with `-c copy` and `-avoid_negative_ts make_zero`. Measured on a known-clean source:

| approach | video start | audio start |
|---|---|---|
| input (clean) | 0.000s | 0.000s |
| `video-cutter`'s arguments | **6.866s** | 0.000s |
| `-ss` before `-i`, `-c copy` | 0.000s | 0.000s |
| `-ss` before `-i`, re-encode | 0.000s | 0.000s |

Stream copy is not the problem — the argument order is.

This surfaced through orestiada/sep9_2026 (11 Sep 2026), a meeting assembled from three
recordings. The merged file carried a 4.13s video composition offset hidden behind an MP4
edit list, which Mux does not honour, so the published video ran 4.1s behind its transcript.
The same file also drifted up to 1.4s against its own transcript, with the drift stepping at
two points that match keyframe irregularities at t≈10549 and t≈15769 — the two joins.

Both defects trace to the merge/cut step. Guards were added downstream in
opencouncil-tasks, but the durable fix is a tool that cannot produce such files.

## Model

A session has one or more ordered source videos and produces one or more outputs.
An output is an ordered list of clips; a clip is `(source, start, end)`.

That is the entire data model:

- **Merge** — one output, three clips, each a whole source
- **Split** — one source, two outputs, one clip each
- **Remove ads** — one output, two clips from one source

Sources are always chronological and are never reordered.

## Interface

**The spec is the product.** A job is a JSON document. The UI's Export button builds a spec
and hands it to the same code path an agent invokes, so the two front ends cannot drift.

```
video-edit inspect <file>              durations, keyframes, A/V alignment
video-edit plan   --spec job.json      what would happen, without doing it
video-edit export --spec job.json      do it, verify, report
```

Shorthand flags for the common jobs, which compose:

```bash
video-edit export --input a.mp4 --input b.mp4 --input c.mp4 --out merged.mp4
video-edit export --input rec.mp4 --remove 1:02:03-1:06:15 --out clean.mp4
video-edit export --input rec.mp4 --split 2:30:00 --out-dir ./parts
```

Agent-facing requirements, in priority order:

1. `plan` is a first-class verb, not a `--dry-run` flag — an agent shows its human what will
   be produced before committing to a ten-minute irreversible operation.
2. Structured JSON output on request: files produced, durations, per-file verification
   result. An agent must be able to confirm success, not infer it from exit code 0.
3. Errors are written to be acted on: "Source 2 is 1920x1080 but source 1 is 1280x720;
   these cannot be joined without re-encoding", not an ffmpeg stack trace.
4. `inspect` is the diagnostic verb. It overlaps `check-av-sync` in opencouncil-tasks
   deliberately: that one is a server-side pipeline guard, this one is operator-facing.

## UI

One window, three zones: player on top, marking buttons, then a **Result strip** and the
source list.

```
┌──────────────────────────────────────────────┐
│  [ video player ]   ▶ 00:42:17 / 05:41:42    │
├──────────────────────────────────────────────┤
│  Cut from here    Cut to here    Split here  │
├──────────────────────────────────────────────┤
│  Result: ████████████░░░░████████│███████     │
│          part 1 (2:14:03)      part 2 (1:02) │
│                       ↑ removed 4:12         │
├──────────────────────────────────────────────┤
│  Sources: ① rec-1  ② rec-2  ③ rec-3 [Export] │
└──────────────────────────────────────────────┘
```

The Result strip always shows exactly what will be produced. Every action changes it;
nothing is hidden. No project, layer or track concepts.

Marking uses the player position, and every marker also has an editable `HH:MM:SS.mmm`
field with ±1 frame / ±1 second nudges. Editing the number moves the marker *and seeks the
player to it*, so the frame is visible for confirmation. This also accepts a pasted
timestamp. Frame-level nudging is only meaningful because cuts are frame-accurate.

Export asks for a destination, writes one file per part, and shows per-file verification.
An export screen offers **copy as command**, so a job done once by hand becomes a command
to hand an agent next time.

Out of scope: reordering sources, transitions, effects.

**Window size:** the app window is 720×860, too narrow for a player plus timeline. This tool
needs a wider window, either a larger app minimum or sizing on open.

## Engine

Per clip, the planner reads keyframe positions and splits the range into up to three pieces:
a re-encoded head (requested start → first keyframe), a stream-copied middle (keyframe →
keyframe), and a re-encoded tail. Clips shorter than one GOP are re-encoded whole.
Boundaries already on a keyframe produce no edge piece.

**Audio is never smart-cut. It is always re-encoded in one continuous pass.** Audio frames
are tiny, so ranges are sample-accurate with no keyframe constraint, and a 5-hour AAC encode
costs 1-3 minutes against 25-40 for video. Decisively: concatenating pre-encoded AAC is
where encoder priming and padding produce the per-join discontinuities that became
orestiada's 1.4s drift. One continuous stream with `aresample=async=1:first_pts=0` makes
that class of bug structurally impossible. Generation loss on 128k speech does not weigh
against that.

Video is assembled from pieces; audio is produced as one stream; the two are muxed.

**Risk.** Re-encoded edges must be bitstream-compatible with copied middles — codec,
profile, pixel format, framerate, colour parameters. Getting this wrong yields a broken or
subtly desynced file, i.e. exactly the failure being eliminated.

**Verification is part of export, and failure falls back automatically.** The plan predicts
each output's duration and boundaries. After muxing, the engine checks the real file:
duration against prediction, video-vs-audio start alignment in both views (edit-list applied
and ignored), and clean end-to-end decode. On any failure it discards the result,
re-exports that output with a full re-encode, and reports that it did so. No path produces a
bad file and calls it done. This guard is what makes the smart-cut complexity acceptable.

Source mismatch is detected at plan time and refused with a message naming the files and
fields. Sources are expected always to match; this checks rather than assumes.

## Structure

```
tools/video-edit/
  types.ts       Source, Clip, Output, ExportPlan, ProgressEvent
  core.ts        planExport(sources, outputs) -> ExportPlan   [pure, no I/O]
  core.test.ts   planner unit tests
  execute.ts     runs an ExportPlan via ffmpeg, emits progress, verifies
  cli.ts         scriptable entry
  sidecar.ts     app entry, wraps execute with createSidecar()
app/src/video-edit.ts    UI module, lazy-loaded like yt-download
app/index.html           tool card + view
app/build-sidecar.sh     add tools/video-edit/sidecar.ts
```

`core.ts` touches no files and spawns nothing, so all the genuinely tricky logic is a pure
function. `execute.ts` is deliberately dumb: run these commands, report progress, verify.

ffmpeg and ffprobe come from the `ensureDeps` pattern `yt-download` already uses.

## Testing

- **Planner unit tests** carry the weight: boundary on a keyframe, boundary mid-GOP, clip
  shorter than a GOP, three-source merge (no edge pieces), ad removal, split into two
  outputs, and predicted durations.
- **Integration tests on generated fixtures** — seconds of `testsrc` with a known GOP. Each
  asserts duration matches prediction, A/V alignment is clean in both views, and the frame
  at a known offset is the one requested. Fast enough for CI.
- **One regression test is the point:** run the job `video-cutter` does today and assert
  video and audio start together. Fails against the old tool, passes against this one.
- **Fixtures are not sufficient before shipping.** Today's defects came from a 5h41m file
  with an unusual GOP structure and 96kHz audio; neither appears in a synthetic clip. Final
  gate is running the CLI over a real merged recording and checking with `inspect`.

## Delivery

Two phases. The first is independently useful — it is the agent-facing interface, and the
one that stops broken files being produced.

**Phase 1 — engine and CLI.**
Done when: `video-edit export --input rec.mp4 --remove 1:02:03-1:06:15 --out clean.mp4` runs
against a real 5-hour recording, and `video-edit inspect clean.mp4` reports video and audio
starting together with the ad gone at exactly the requested timestamps. At that point
operations can already ask an agent to do the work.

**Phase 2 — the app.**
Done when: a non-technical user opens the toolkit app, loads three recordings, removes an ad
break, splits the result, exports, and sees per-file verification pass — without typing a
timestamp unless they want to.

The riskiest unknown is front-loaded into phase 1: whether re-encoded edges concatenate
cleanly with copied middles across real-world GOP structures. If smart cut proves unworkable,
that is discovered before any UI is built, and the fallback is a full re-encode — slower, but
the design already depends on that path existing.

### Phase 1 findings (2026-09-13)

Smart cut works. Fixture tests merge, trim and split with `reEncoded: false` throughout, so
the fallback is not quietly carrying the engine.

Validating against the real 5h41m recording found two problems that synthetic fixtures could
not, both about scale rather than correctness:

- **Keyframe reading was pathologically slow.** `ffprobe -skip_frame nokey` decodes headers
  for every frame in the file and did not finish in ten minutes. Reading packet flags instead
  demuxes only, and completes in ~50s for ~10k keyframes. This is why `plan` on a five-hour
  file takes about a minute.
- **Full-decode verification cost more than the export.** It is now opt-in behind `--deep`.
  The structural checks — duration against prediction, and A/V start offset with the edit
  list both applied and ignored — are metadata-only, instant, and are the ones that catch the
  defect class this tool exists to prevent.

`inspect` diagnoses the original orestiada source correctly in 43s, reporting the 4.130s
edit-list-hidden offset in the exact terms an operator can act on.

**Correctness on the real file is confirmed.** Removing 1:00:00-1:04:00 from the 5h41m
recording produced exactly 20262.0s against a predicted 20262.1s, verified, with no
fallback, and an A/V offset of 0.067s. The cut is frame-accurate: silence onsets after the
gap match the source shifted by 240s to within 11 microseconds.

**Timing: ~11 minutes, not the 2-3 this document predicted.** That estimate was wrong and is
corrected here rather than quietly dropped. Where it goes, on a 5h41m 2.6GB file:

- keyframe scan ~50s
- video pieces and their concat ~1-2 min
- the audio pass and final mux, the remaining ~8 min

Audio dominates, and that is inherent: the source is 96kHz stereo, and every output decodes
and re-encodes its audio end to end. That is the cost of the guarantee that no pre-encoded
AAC is ever concatenated, and it is the right trade — but it caps the benefit smart cut can
deliver. Measured against the ~24 minutes a full re-encode of the same file took, smart cut
is worth roughly 2x here, not the 10x implied above.

One unexercised optimisation is identified and deliberately not taken yet: the video is
currently written three times (pieces, concat, mux). The concat demuxer supports `inpoint`
and `outpoint`, so copied ranges could be referenced in the source file rather than written
out — our copy ranges are keyframe-aligned by construction, which is exactly the condition
that makes this safe. That would remove ~2.3GB of writes and one full pass. It should be
measured before being adopted, since audio would still dominate.

## Migration

`video-cutter` is retired once this ships, and the team told to stop using it — every cut it
produces is desynced, so leaving it installed keeps generating broken files.

Recordings already cut with it may carry the defect. `video-edit inspect` (or
`opencouncil-tasks`' `check-av-sync`) identifies them.
