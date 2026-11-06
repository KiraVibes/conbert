import { useFiles, type FileItem } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import { saveToTargets } from './storage-api';

/**
 * "Save every conversion automatically": after a result is finished, it is
 * also put on the chosen storage location. Runs in the background; the card
 * shows how it went. Like "Save to …", the file goes through the server.
 */
export async function autoSaveResult(item: FileItem): Promise<void> {
  const targetId = useSettings.getState().autoSaveTargetId;
  const result = item.result;
  if (!targetId || !result) return;
  const set = (autoSave: FileItem['autoSave']) => useFiles.getState().update(item.id, { autoSave });
  set({ state: 'saving', targetId });
  try {
    const [outcome] = await saveToTargets(result.blob, result.fileName, [targetId], undefined);
    if (!outcome || outcome.status === 'error') {
      set({
        state: 'error',
        targetId,
        error: {
          messageKey: outcome?.error?.messageKey ?? 'errors.storageFailed',
          ...(outcome?.error?.details && { details: outcome.error.details }),
        },
      });
      return;
    }
    set({
      state: outcome.status === 'skipped' ? 'skipped' : 'saved',
      targetId,
      ...(outcome.path && { path: outcome.path }),
    });
  } catch (error) {
    set({
      state: 'error',
      targetId,
      error:
        error instanceof ApiRequestError
          ? { messageKey: error.messageKey, ...(error.details && { details: error.details }) }
          : { messageKey: 'errors.network', details: String(error) },
    });
  }
}
