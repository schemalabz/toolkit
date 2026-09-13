/** Video stream parameters that must match across sources for stream-copy concat. */
export interface VideoParams {
  codec: string;
  width: number;
  height: number;
  /** Exact rational as ffprobe reports it, e.g. "30000/1001". */
  fps: string;
  pixFmt: string;
}

export interface AudioParams {
  codec: string;
  sampleRate: number;
  channels: number;
}

/** A probed input file. `keyframes` is sorted ascending, in seconds. */
export interface Source {
  id: string;
  path: string;
  durationSec: number;
  keyframes: number[];
  video: VideoParams;
  audio: AudioParams;
}

/** A half-open range [start, end) of one source, in seconds. */
export interface Clip {
  sourceId: string;
  start: number;
  end: number;
}

export interface Output {
  name: string;
  clips: Clip[];
}

/** 'copy' pieces are stream-copied; 'encode' pieces are re-encoded to match. */
export type PieceKind = 'copy' | 'encode';

export interface Piece {
  sourceId: string;
  start: number;
  end: number;
  kind: PieceKind;
}

export interface OutputPlan {
  name: string;
  /** Video pieces in output order. */
  videoPieces: Piece[];
  /** Ranges for the single continuous audio pass, in output order. */
  audioRanges: Clip[];
  expectedDurationSec: number;
}

export interface ExportPlan {
  outputs: OutputPlan[];
}
