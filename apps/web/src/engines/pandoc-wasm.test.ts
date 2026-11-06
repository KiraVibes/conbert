// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPandocInstance, type PandocInstance } from 'pandoc-wasm/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { convertWithPandocWasm } from './pandoc-wasm-convert';
import { pandocWasmEngine } from './pandoc-wasm';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)));
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const noop = () => undefined;

let pandoc: PandocInstance;
beforeAll(async () => {
  const wasm = path.resolve(import.meta.dirname, '../../node_modules/pandoc-wasm/src/pandoc.wasm');
  pandoc = await createPandocInstance(readFileSync(wasm));
}, 60_000);

describe('pandoc-wasm engine', () => {
  it('has texts and registry entries', () => {
    expect(findMissingKeys(engineI18nKeys(pandocWasmEngine))).toEqual([]);
    for (const f of pandocWasmEngine.formats) expect(getFormat(f.ext), f.ext).toBeDefined();
  });

  it('converts Markdown → DOCX → Markdown and keeps umlauts', async () => {
    const docx = await convertWithPandocWasm(pandoc, fixture('sample.md'), 'md', 'docx', {}, noop);
    expect(text(docx.subarray(0, 2))).toBe('PK');
    const md = text(await convertWithPandocWasm(pandoc, docx, 'docx', 'md', {}, noop));
    expect(md).toContain('Conbert Testdokument');
    expect(md).toContain('äöü ß');
  });

  it('writes a standalone HTML page with a table of contents', async () => {
    const html = text(
      await convertWithPandocWasm(
        pandoc,
        fixture('sample.docx'),
        'docx',
        'html',
        { tableOfContents: true, title: 'Mein Bericht' },
        noop,
      ),
    );
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>Mein Bericht</title>');
  });

  it('names an e-book after the document, else after the file', async () => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const epubTitle = async (input: Uint8Array, from: string, options: Record<string, unknown>) => {
      const files = unzipSync(
        await convertWithPandocWasm(pandoc, input, from, 'epub', options, noop),
      );
      const opf = Object.entries(files).find(([name]) => name.endsWith('.opf'))?.[1];
      return {
        title: strFromU8(opf ?? new Uint8Array()).match(/<dc:title[^>]*>([^<]*)/)?.[1],
        titlePage: Object.keys(files).some((name) => name.endsWith('title_page.xhtml')),
      };
    };
    const titled = new TextEncoder().encode('---\ntitle: Echter Titel\n---\n\nText\n');
    expect(await epubTitle(titled, 'md', { title: 'datei' })).toMatchObject({
      title: 'Echter Titel',
    });
    expect(await epubTitle(fixture('sample.docx'), 'docx', { title: 'Mein_Bericht' })).toEqual({
      title: 'Mein_Bericht',
      titlePage: true,
    });
    expect(
      await epubTitle(fixture('sample.docx'), 'docx', { title: 'x', epubTitlePage: false }),
    ).toMatchObject({ titlePage: false });
  });

  it('reports broken files as a conversion error and keeps working', async () => {
    await expect(
      convertWithPandocWasm(pandoc, new TextEncoder().encode('nope'), 'docx', 'md', {}, noop),
    ).rejects.toMatchObject({ messageKey: 'errors.convertFailed' });
    const txt = await convertWithPandocWasm(pandoc, fixture('sample.md'), 'md', 'txt', {}, noop);
    expect(txt.byteLength).toBeGreaterThan(0);
  });
});
