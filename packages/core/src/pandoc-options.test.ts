import { describe, expect, it } from 'vitest';
import { pandocArgs, pandocMetadataYaml, pandocWasmOptions } from './options/document';

describe('pandoc options', () => {
  it('builds CLI args with the sandbox always on', () => {
    expect(pandocArgs('md', 'epub', { tableOfContents: true }, 'Buch')).toEqual([
      '--sandbox',
      '-f',
      'markdown',
      '-t',
      'epub3',
      '--standalone',
      '--metadata-file',
      'conbert-metadata.yaml',
      '--toc',
    ]);
  });

  it('gives pandoc-wasm the same settings as defaults-file keys', () => {
    expect(pandocWasmOptions('md', 'epub', { tableOfContents: true }, 'Buch')).toEqual({
      from: 'markdown',
      to: 'epub3',
      standalone: true,
      'metadata-files': ['conbert-metadata.yaml'],
      'table-of-contents': true,
    });
    expect(pandocWasmOptions('docx', 'md', { markdownFlavor: 'commonmark' }, 'x')).toEqual({
      from: 'docx',
      to: 'commonmark',
      standalone: false,
      wrap: 'none',
    });
  });

  it('uses the file name only as a fallback title, kept literal', () => {
    // A metadata file: the document's own title wins over it (unlike --metadata).
    expect(pandocMetadataYaml('docx', 'epub', {}, 'Bericht_2024 *final*')).toBe(
      'title: "Bericht\\\\_2024 \\\\*final\\\\*"\n',
    );
    expect(pandocMetadataYaml('docx', 'html', {}, 'A')).toBe('pagetitle: "A"\n');
    expect(pandocMetadataYaml('docx', 'md', {}, 'A')).toBeNull();
    expect(pandocArgs('docx', 'md', {}, 'A')).not.toContain('--metadata-file');
  });

  it('leaves out the EPUB title page on request', () => {
    expect(pandocArgs('docx', 'epub', { epubTitlePage: false }, 'A')).toContain(
      '--epub-title-page=false',
    );
    expect(pandocWasmOptions('docx', 'epub', { epubTitlePage: false }, 'A')).toMatchObject({
      'epub-title-page': false,
    });
    expect(pandocArgs('docx', 'epub', {}, 'A')).not.toContain('--epub-title-page=false');
  });

  it('rejects unknown formats', () => {
    expect(() => pandocWasmOptions('pdf', 'md', {}, 'x')).toThrow(/not supported/);
  });
});
