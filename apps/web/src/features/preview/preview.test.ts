import { describe, expect, it } from 'vitest';
import { displayTarget, previewKind } from './preview-source';
import { sanitizeHtmlDocument, sanitizeSvg } from './sanitize';

describe('sanitize', () => {
  it('strips scripts and event handlers from SVG', () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="5" height="5" fill="red"/></svg>',
    );
    expect(svg).not.toMatch(/script|onload|alert/);
    expect(svg).toContain('<rect');
  });

  it('cleans HTML and blocks everything from the network', () => {
    const html = sanitizeHtmlDocument(
      '<html><head><link rel="stylesheet" href="https://evil.example/x.css"></head><body><p onclick="x()">Hallo</p><script>steal()</script><img src="https://evil.example/t.png"></body></html>',
    );
    expect(html).not.toMatch(/script|onclick|<link/);
    expect(html).toContain('Hallo');
    expect(html).toContain("default-src 'none'");
  });
});

describe('preview kinds', () => {
  it('picks a renderer per format', () => {
    expect(previewKind('png')).toBe('image');
    expect(previewKind('svg')).toBe('svg');
    expect(previewKind('mp3')).toBe('audio');
    expect(previewKind('mid')).toBe('audio');
    expect(previewKind('mp4')).toBe('video');
    expect(previewKind('pdf')).toBe('pdf');
    expect(previewKind('md')).toBe('text');
    expect(previewKind('srt')).toBe('text');
    expect(previewKind('ass')).toBe('text');
    expect(previewKind('docx')).toBe('document');
    expect(previewKind('gba')).toBe('none');
    expect(previewKind('sf2')).toBe('none');
  });

  it('converts what the browser cannot show', () => {
    expect(displayTarget('image', 'png')).toBeNull();
    expect(displayTarget('image', 'heic')).toEqual(['png']);
    expect(displayTarget('image', 'tiff')).toEqual(['png']);
    expect(displayTarget('audio', 'mid')).toEqual(['wav']);
    expect(displayTarget('document', 'docx')).toEqual(['html']);
  });
});
