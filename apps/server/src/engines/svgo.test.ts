import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compressionOptions, findRoutes, type EngineDescriptor } from '@conbert/core';
import { svgoEngine } from './svgo';

const fixture = path.join(import.meta.dirname, '../__fixtures__/sample.svg');
const workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-svgo-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** An SVG as drawing programs write it: comments, editor data, long numbers. */
const BLOATED = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Created with a drawing program -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  width="100" height="100" viewBox="0 0 100 100" inkscape:version="1.3">
  <title>Kreis</title>
  <metadata><rdf>notes</rdf></metadata>
  <g inkscape:label="Ebene 1" inkscape:groupmode="layer">
    <circle cx="50.000000123" cy="49.99999987" r="40.123456789" fill="#ff0000"/>
  </g>
</svg>`;

describe('svgo', () => {
  it('makes an SVG smaller and keeps title and viewBox', async () => {
    const input = path.join(workDir, 'in.svg');
    writeFileSync(input, BLOATED);
    const out = await svgoEngine.convert({
      input,
      inputExt: 'svg',
      outputExt: 'svg',
      options: compressionOptions('svg', { level: 'balanced', stripMetadata: true }),
      workDir,
    });
    const text = readFileSync(out as string, 'utf8');
    expect(text.length).toBeLessThan(BLOATED.length / 2);
    expect(text).toContain('<title>Kreis</title>');
    expect(text).toContain('viewBox="0 0 100 100"');
    expect(text).not.toContain('inkscape');
    expect(text).toContain('r="40.123"');
  });

  it('keeps editor data when asked', async () => {
    const input = path.join(workDir, 'keep.svg');
    writeFileSync(input, BLOATED);
    const out = await svgoEngine.convert({
      input,
      inputExt: 'svg',
      outputExt: 'svg',
      options: { svgKeepEditorData: true, svgPrecision: 'high' },
      workDir,
    });
    expect(readFileSync(out as string, 'utf8')).toContain('inkscape:label');
  });

  it('handles the fixture and reports broken files clearly', async () => {
    const out = await svgoEngine.convert({
      input: fixture,
      inputExt: 'svg',
      outputExt: 'svg',
      options: {},
      workDir,
    });
    expect(statSync(out as string).size).toBeLessThanOrEqual(statSync(fixture).size);
    const broken = path.join(workDir, 'broken.svg');
    writeFileSync(broken, '<svg><g></svg');
    await expect(
      svgoEngine.convert({
        input: broken,
        inputExt: 'svg',
        outputExt: 'svg',
        options: {},
        workDir,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.convertFailed' });
  });

  it('is the route for compressing SVGs', () => {
    const { init: _i, status, convert: _c, ...rest } = svgoEngine;
    const descriptor: EngineDescriptor = { ...rest, status: status() };
    const [route] = findRoutes([descriptor], 'svg', 'svg', 'server', { compress: true });
    expect(route?.steps.map((s) => s.engineId)).toEqual(['svgo']);
  });
});
