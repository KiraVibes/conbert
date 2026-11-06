import { describe, expect, it } from 'vitest';
import { bytesReader } from './reader';
import { parseEbml } from './structure-ebml';

/** One EBML element: ID bytes, size (1 or 2 bytes), content. */
function el(id: number[], ...content: (number[] | Uint8Array)[]): number[] {
  const body = content.flatMap((c) => [...c]);
  const size =
    body.length < 127 ? [0x80 | body.length] : [0x40 | (body.length >> 8), body.length & 255];
  return [...id, ...size, ...body];
}
const str = (s: string) => [...new TextEncoder().encode(s)];
function f64(n: number): number[] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  return [...new Uint8Array(view.buffer)];
}

const webm = Uint8Array.from([
  ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x86], [1]), el([0x42, 0x82], str('webm'))),
  ...el(
    [0x18, 0x53, 0x80, 0x67],
    el(
      [0x15, 0x49, 0xa9, 0x66],
      el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]),
      el([0x44, 0x89], f64(2500)),
      el([0x4d, 0x80], str('Conbert-Test')),
    ),
    el(
      [0x16, 0x54, 0xae, 0x6b],
      el(
        [0xae],
        el([0x86], str('V_VP9')),
        el([0xe0], el([0xb0], [0x01, 0x40]), el([0xba], [0xf0])),
      ),
      el([0xae], el([0x86], str('A_OPUS')), el([0xe1], el([0x9f], [2]))),
    ),
    el([0x1f, 0x43, 0xb6, 0x75], new Uint8Array(40)),
  ),
  // Something hidden behind the end.
  ...str('PK'),
]);

describe('Matroska / WebM structure', () => {
  it('explains header, description, tracks and clusters', async () => {
    const s = await parseEbml(bytesReader(webm));
    expect(s.regions.map((r) => r.key)).toEqual([
      'mkv.signature',
      'mkv.header',
      'mkv.segment',
      'mkv.elements.info',
      'mkv.elements.tracks',
      'mkv.elements.cluster',
      'appended',
    ]);
    const fields = Object.fromEntries(
      s.regions.flatMap((r) => r.fields ?? []).map((f) => [f.key, f.value]),
    );
    expect(fields).toMatchObject({
      docType: 'webm',
      ebmlVersion: 1,
      duration: 2.5,
      muxingApp: 'Conbert-Test',
      width: 320,
      height: 240,
      channels: 2,
    });
    expect(s.regions.find((r) => r.key === 'mkv.elements.tracks')?.label).toBe('V_VP9 · A_OPUS');
    expect(s.appendedAt).toBe(webm.length - 2);
    for (const r of s.regions) {
      for (const f of r.fields ?? []) {
        expect(f.start).toBeGreaterThanOrEqual(r.start);
        expect(f.end).toBeLessThanOrEqual(r.end);
      }
    }
  });

  it('runs a cluster without a size to the end (live recordings)', async () => {
    const live = Uint8Array.from([
      ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], str('matroska'))),
      0x18,
      0x53,
      0x80,
      0x67,
      0x01,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0x1f,
      0x43,
      0xb6,
      0x75,
      0xff,
      ...new Array(30).fill(7),
    ]);
    const s = await parseEbml(bytesReader(live));
    expect(s.regions.at(-1)).toMatchObject({ key: 'mkv.elements.cluster', end: live.length });
    expect(s.appendedAt).toBeNull();
  });
});
