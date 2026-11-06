import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pandocArgs, resolveVectorOptions, vtracerArgs } from '@conbert/core';
import { hasCommand } from '../test/helpers';
import { pandocEngine } from './pandoc';
import { vtracerEngine } from './vtracer';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

describe('pandoc arguments', () => {
  it('always runs sandboxed', () => {
    expect(pandocArgs('tex', 'html', {}, 'T')[0]).toBe('--sandbox');
  });

  it('maps formats to readers and writers', () => {
    expect(pandocArgs('docx', 'md', {}, 'T')).toEqual(
      expect.arrayContaining(['-f', 'docx', '-t', 'gfm', '--wrap=none']),
    );
    expect(pandocArgs('md', 'txt', {}, 'T')).toEqual(expect.arrayContaining(['-t', 'plain']));
    expect(pandocArgs('txt', 'docx', {}, 'T')).toEqual(
      expect.arrayContaining(['-f', 'markdown', '--standalone']),
    );
  });

  it('adds a fallback title for HTML and EPUB, a table of contents on request', () => {
    expect(pandocArgs('md', 'epub', { tableOfContents: true }, 'Mein Buch')).toEqual(
      expect.arrayContaining(['--metadata-file', 'conbert-metadata.yaml', '--toc']),
    );
    expect(pandocArgs('md', 'rst', { tableOfContents: true }, 'T')).not.toContain('--toc');
  });

  it('respects the Markdown variant', () => {
    expect(pandocArgs('html', 'md', { markdownFlavor: 'commonmark' }, 'T')).toEqual(
      expect.arrayContaining(['-t', 'commonmark']),
    );
  });

  it('refuses unknown formats', () => {
    expect(() => pandocArgs('pdf', 'md', {}, 'T')).toThrow();
  });
});

describe('vtracer arguments', () => {
  it('maps the simple choices to vtracer flags', () => {
    const args = vtracerArgs(resolveVectorOptions({ colorMode: 'bw', vectorDetail: 'small' }));
    expect(args).toEqual(expect.arrayContaining(['--colormode', 'bw', '--filter_speckle', '10']));
    expect(vtracerArgs(resolveVectorOptions({}))).toEqual(
      expect.arrayContaining(['--colormode', 'color', '--mode', 'spline']),
    );
  });

  it('sets every tracing value from the detail level, unless overridden', () => {
    const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
    const max = vtracerArgs(resolveVectorOptions({ vectorDetail: 'max' }));
    expect(flag(max, '--filter_speckle')).toBe('0');
    expect(flag(max, '--color_precision')).toBe('8');
    expect(flag(max, '--gradient_step')).toBe('1');
    expect(flag(max, '--segment_length')).toBe('3.5');
    const mixed = vtracerArgs(
      resolveVectorOptions({
        vectorDetail: 'min',
        vectorSpeckle: 'finest',
        vectorCorners: 'auto',
        vectorLayers: 'cutout',
      }),
    );
    expect(flag(mixed, '--filter_speckle')).toBe('0');
    expect(flag(mixed, '--corner_threshold')).toBe('130');
    expect(flag(mixed, '--hierarchical')).toBe('cutout');
    // Unknown values fall back to safe defaults.
    expect(
      flag(vtracerArgs(resolveVectorOptions({ vectorSpeckle: 'x' })), '--filter_speckle'),
    ).toBe('4');
  });

  it('can enlarge small pictures before tracing', () => {
    expect(resolveVectorOptions({}).traceSize).toEqual({ maxSide: 2048, enlarge: false });
    expect(resolveVectorOptions({ vectorTraceSize: 'max' }).traceSize).toEqual({
      maxSide: 4096,
      enlarge: true,
    });
  });
});

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-docs-'));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe.skipIf(!hasCommand('pandoc', ['--version']))('pandoc conversions (real)', () => {
  beforeAll(() => pandocEngine.init());
  const inputs = ['md', 'docx', 'odt', 'html'];
  const outputs = pandocEngine.formats.filter((f) => f.canWrite).map((f) => f.ext);
  for (const from of inputs) {
    for (const to of outputs) {
      if (from === to) continue;
      it(`${from} → ${to}`, async () => {
        const out = String(
          await pandocEngine.convert({
            input: path.join(fixtures, `sample.${from}`),
            inputExt: from,
            outputExt: to,
            options: {},
            workDir,
          }),
        );
        const content = readFileSync(out);
        expect(content.length).toBeGreaterThan(0);
        if (['md', 'txt', 'html', 'rst', 'tex', 'org'].includes(to)) {
          expect(content.toString('utf8')).toContain('Testdokument');
        }
      });
    }
  }

  const epubTitle = async (input: string, from: string, options: Record<string, unknown>) => {
    const out = String(
      await pandocEngine.convert({ input, inputExt: from, outputExt: 'epub', options, workDir }),
    );
    // An EPUB is a ZIP; bsdtar is in the same image as pandoc.
    const names = execFileSync('bsdtar', ['-tf', out], { encoding: 'utf8' }).split('\n');
    const opf = names.find((name) => name.endsWith('.opf')) ?? 'content.opf';
    const content = execFileSync('bsdtar', ['-xOf', out, opf], { encoding: 'utf8' });
    return {
      title: content.match(/<dc:title[^>]*>([^<]*)/)?.[1],
      titlePage: names.some((name) => name.endsWith('title_page.xhtml')),
    };
  };

  it('names an e-book after the document, else after the file', async () => {
    const titled = path.join(workDir, 'titled.md');
    writeFileSync(titled, '---\ntitle: Echter Titel\n---\n\nText\n');
    expect(await epubTitle(titled, 'md', { title: 'datei' })).toMatchObject({
      title: 'Echter Titel',
    });
    const plain = path.join(fixtures, 'sample.docx');
    expect(await epubTitle(plain, 'docx', { title: 'Mein_Bericht' })).toEqual({
      title: 'Mein_Bericht',
      titlePage: true,
    });
    expect(await epubTitle(plain, 'docx', { title: 'x', epubTitlePage: false })).toMatchObject({
      titlePage: false,
    });
  });

  it('does not read other files on the server (sandbox)', async () => {
    const evil = path.join(workDir, 'evil.tex');
    writeFileSync(
      evil,
      '\\documentclass{article}\\begin{document}\\input{/etc/passwd}\\end{document}',
    );
    const out = await pandocEngine
      .convert({ input: evil, inputExt: 'tex', outputExt: 'txt', options: {}, workDir })
      .then((p) => readFileSync(String(p), 'utf8'))
      .catch(() => '');
    expect(out).not.toContain('root:');
  });
});

describe.skipIf(!hasCommand('vtracer', ['--help']))('vtracer conversions (real)', () => {
  beforeAll(() => vtracerEngine.init());
  for (const from of ['png', 'jpg', 'webp']) {
    it(`${from} → svg`, async () => {
      const out = String(
        await vtracerEngine.convert({
          input: path.join(fixtures, `sample.${from}`),
          inputExt: from,
          outputExt: 'svg',
          options:
            from === 'png'
              ? { vectorDetail: 'max', vectorTraceSize: 'fine', vectorLayers: 'cutout' }
              : { vectorDetail: 'high' },
          workDir,
        }),
      );
      const svg = readFileSync(out, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('<path');
    });
  }
});
