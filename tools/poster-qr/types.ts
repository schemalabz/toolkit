export interface PaperBatch {
  paper: 'A4' | 'A3';
  count: number;
}

export interface PosterConfig {
  templatePath: string;
  baseUrl: string;
  campaign: string;
  source: string;
  batches: PaperBatch[];
  start: number;
  prefix: string;
  padDigits: number;
  outDir: string;
  dryRun: boolean;
  qrX: number;
  qrY: number;
  qrSize: number;
  idCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  idSize: number;
  idColor: string;
  idOffset: number;
}

export interface MarkerResult {
  x: number;
  y: number;
  size: number;
  matchCount: number;
  boundingBox: { minX: number; minY: number; width: number; height: number };
}

export type ProgressEvent =
  | { type: 'info'; message: string }
  | { type: 'batch-start'; paper: string; count: number }
  | { type: 'poster'; id: string; paper: string; index: number; total: number }
  | { type: 'pdf-saved'; paper: string; path: string; sizeMb: string }
  | { type: 'done'; totalCount: number }
  | { type: 'dry-run-item'; id: string; paper: string; url: string }
  | { type: 'dry-run-done'; totalCount: number }
  | { type: 'error'; message: string };
