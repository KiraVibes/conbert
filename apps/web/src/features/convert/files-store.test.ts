import { afterEach, describe, expect, it } from 'vitest';
import { recordResult, useHistory } from '@/features/archive/history-store';
import { DEFAULT_COMPRESS, cleanBaseName, splitName, useFiles, type FileItem } from './files-store';

function item(patch: Partial<FileItem> = {}): FileItem {
  return {
    id: 'a',
    file: new File(['x'], 'Urlaub.jpg'),
    name: 'Urlaub.jpg',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    ext: 'jpg',
    extMismatch: false,
    nameExt: 'jpg',
    previewUrl: null,
    targetExt: 'webp',
    mode: 'local',
    options: {},
    status: 'idle',
    progress: 0,
    ...patch,
  };
}

const result = { blob: new Blob(['y']), url: 'blob:x', ext: 'webp', fileName: 'Urlaub.webp' };

afterEach(() => {
  useFiles.setState({ files: [] });
  useHistory.setState({ entries: [] });
});

describe('file names', () => {
  it('splits off the extension', () => {
    expect(splitName('photo.final.jpg')).toEqual({ base: 'photo.final', suffix: '.jpg' });
    expect(splitName('README')).toEqual({ base: 'README', suffix: '' });
    expect(splitName('.hidden')).toEqual({ base: '.hidden', suffix: '' });
  });

  it('cleans what the user types', () => {
    expect(cleanBaseName('  Sommer: 2026/Teil 1  ')).toBe('Sommer_ 2026_Teil 1');
    expect(cleanBaseName('...geheim')).toBe('geheim');
    expect(cleanBaseName('   ')).toBeNull();
  });
});

describe('rename', () => {
  it('keeps the extension and renames an existing result', () => {
    useFiles.setState({ files: [item({ status: 'done', result })] });
    useFiles.getState().rename('a', 'Strand');
    const [f] = useFiles.getState().files;
    expect(f?.name).toBe('Strand.jpg');
    expect(f?.result?.fileName).toBe('Strand.webp');
  });

  it('ignores empty names', () => {
    useFiles.setState({ files: [item()] });
    useFiles.getState().rename('a', '  ');
    expect(useFiles.getState().files[0]?.name).toBe('Urlaub.jpg');
  });
});

describe('archive (history)', () => {
  it('keeps every finished file, newest first, and follows renames', () => {
    const done = item({ status: 'done', result });
    useFiles.setState({ files: [done] });
    recordResult(done);
    recordResult({
      ...done,
      id: 'b',
      name: 'Berge.jpg',
      result: { ...result, fileName: 'Berge.webp' },
    });
    expect(useHistory.getState().entries.map((e) => e.fileName)).toEqual([
      'Berge.webp',
      'Urlaub.webp',
    ]);

    useFiles.getState().rename('a', 'Strand');
    expect(useHistory.getState().entries.map((e) => e.fileName)).toContain('Strand.webp');
  });

  it('"remove all" only empties the list of its own tab', () => {
    useFiles.setState({
      files: [item(), item({ id: 'b', task: 'compress' })],
    });
    useFiles.getState().clear('convert');
    expect(useFiles.getState().files.map((f) => f.id)).toEqual(['b']);
  });
});
