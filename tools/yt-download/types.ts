export type ProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'download-progress'; percent: number; downloaded: string; total: string }
  | { type: 'upload-progress'; status: 'uploading' | 'done'; percent?: number }
  | { type: 'complete'; cdnUrl: string }
  | { type: 'error'; message: string };

export interface BackupConfig {
  youtubeUrl: string;
  outputDir: string;
  localOnly: boolean;
  serverUrl: string;
  apiKey: string;
}

export interface SidecarOptions {
  ytdlpPath?: string;
  ffmpegPath?: string;
}
