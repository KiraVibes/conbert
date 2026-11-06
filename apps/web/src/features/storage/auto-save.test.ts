import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFiles, type FileItem } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import { autoSaveResult } from './auto-save';
import { saveToTargets } from './storage-api';

vi.mock('./storage-api', () => ({ saveToTargets: vi.fn() }));
const save = vi.mocked(saveToTargets);

const TARGET = '11111111-1111-4111-8111-111111111111';

function item(): FileItem {
  const file = new File(['x'], 'Bild.png', { type: 'image/png' });
  const entry = {
    id: 'item-1',
    file,
    name: 'Bild.png',
    task: 'convert',
    status: 'done',
    result: { blob: new Blob(['webp']), url: 'blob:x', ext: 'webp', fileName: 'Bild.webp' },
  } as FileItem;
  useFiles.setState({ files: [entry] });
  return entry;
}

const state = () => useFiles.getState().files[0]?.autoSave;

describe('automatic saving', () => {
  beforeEach(() => {
    save.mockReset();
    useSettings.setState({ autoSaveTargetId: TARGET });
  });

  it('does nothing while the setting is off', async () => {
    useSettings.setState({ autoSaveTargetId: null });
    await autoSaveResult(item());
    expect(save).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
  });

  it('saves the result and remembers where it went', async () => {
    save.mockResolvedValue([{ targetId: TARGET, status: 'saved', path: 'Bild.webp', error: null }]);
    await autoSaveResult(item());
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'Bild.webp', [TARGET], undefined);
    expect(state()).toEqual({ state: 'saved', targetId: TARGET, path: 'Bild.webp' });
  });

  it('says so when the file was already there', async () => {
    save.mockResolvedValue([
      { targetId: TARGET, status: 'skipped', path: 'Bild.webp', error: null },
    ]);
    await autoSaveResult(item());
    expect(state()?.state).toBe('skipped');
  });

  it('shows errors of the location and of the network', async () => {
    save.mockResolvedValue([
      {
        targetId: TARGET,
        status: 'error',
        path: null,
        error: { messageKey: 'errors.storageUnreachable', details: 'no route' },
      },
    ]);
    await autoSaveResult(item());
    expect(state()).toMatchObject({
      state: 'error',
      error: { messageKey: 'errors.storageUnreachable', details: 'no route' },
    });

    save.mockRejectedValue(new ApiRequestError(0, 'errors.network', 'offline'));
    await autoSaveResult(item());
    expect(state()).toMatchObject({ state: 'error', error: { messageKey: 'errors.network' } });
  });
});
