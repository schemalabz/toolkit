import { describe, it, expect } from 'vitest';
import { extractVideoId } from './core.js';

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
