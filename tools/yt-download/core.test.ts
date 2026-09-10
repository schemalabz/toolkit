import { describe, it, expect } from 'vitest';
import { extractVideoId, buildYtdlpArgs } from './core.js';

describe('extractVideoId', () => {
  it('extracts ID from youtube.com/watch?v=...', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from youtu.be/ short links', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from youtube.com/embed/', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('strips query params from youtu.be links', () => {
    expect(extractVideoId('https://youtu.be/abc123?t=42')).toBe('abc123');
  });

  it('strips fragment from youtu.be links', () => {
    expect(extractVideoId('https://youtu.be/abc123#section')).toBe('abc123');
  });

  it('handles youtube.com/watch with extra params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLxyz')).toBe('dQw4w9WgXcQ');
  });

  it('handles embed with query params', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe('dQw4w9WgXcQ');
  });

  it('works without www prefix', () => {
    expect(extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('throws on non-YouTube URL', () => {
    expect(() => extractVideoId('https://example.com/video.mp4')).toThrow('Could not extract video ID');
  });

  it('throws on youtube.com/watch without v param', () => {
    expect(() => extractVideoId('https://youtube.com/watch')).toThrow('Could not extract video ID');
  });

  it('throws on empty youtu.be path', () => {
    expect(() => extractVideoId('https://youtu.be/')).toThrow('Could not extract video ID');
  });
});

describe('buildYtdlpArgs', () => {
  const base = { outputTemplate: '/out/vid.%(ext)s', url: 'https://youtu.be/abc123' };

  it('passes an explicit Deno path as yt-dlp JS runtime when available', () => {
    const args = buildYtdlpArgs({ ...base, denoPath: '/bin/deno' });
    const i = args.indexOf('--js-runtimes');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('deno:/bin/deno');
  });

  it('omits the JS runtime flag when no Deno path is known', () => {
    expect(buildYtdlpArgs(base)).not.toContain('--js-runtimes');
  });

  it('passes the ffmpeg directory, not the binary path', () => {
    const args = buildYtdlpArgs({ ...base, ffmpegPath: '/deps/bin/ffmpeg' });
    const i = args.indexOf('--ffmpeg-location');
    expect(args[i + 1]).toBe('/deps/bin');
  });

  it('keeps the 720p format selector, output template and URL', () => {
    const args = buildYtdlpArgs(base);
    expect(args).toContain('-f');
    expect(args.join(' ')).toContain('bestvideo[height<=720]+bestaudio');
    expect(args[args.indexOf('-o') + 1]).toBe('/out/vid.%(ext)s');
    expect(args[args.length - 1]).toBe('https://youtu.be/abc123');
  });
});
