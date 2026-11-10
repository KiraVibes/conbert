import { useQuery } from '@tanstack/react-query';
import { ConversionError, getFormat } from '@conbert/core';
import {
  browseResponseSchema,
  exportResponseSchema,
  importResponseSchema,
  storageRootsResponseSchema,
  targetResponseSchema,
  targetsResponseSchema,
  type BrowseResponse,
  type ExportResult,
  type PatchTargetRequest,
  type SaveTargetRequest,
  type StorageTargetDto,
} from '@conbert/schemas';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { rememberServerFile, serverJobOf, uploadToServer } from '@/engines/server-convert';
import { useCan } from '@/features/auth/use-auth';

export const TARGETS_KEY = ['storage-targets'] as const;

export function useTargets() {
  const allowed = useCan('storage');
  return useQuery({
    queryKey: TARGETS_KEY,
    enabled: allowed,
    queryFn: ({ signal }) => apiGet('/api/targets', targetsResponseSchema, { signal }),
    select: (data) => data.targets,
  });
}

export function useStorageRoots(enabled: boolean) {
  return useQuery({
    queryKey: ['storage-roots'],
    enabled,
    queryFn: ({ signal }) => apiGet('/api/targets/roots', storageRootsResponseSchema, { signal }),
    select: (data) => data.roots,
  });
}

export async function saveTarget(body: SaveTargetRequest, id?: string): Promise<StorageTargetDto> {
  const res = id
    ? await apiPut(`/api/targets/${id}`, body, targetResponseSchema)
    : await apiPost('/api/targets', body, targetResponseSchema);
  return res.target;
}

export const deleteTarget = (id: string) => apiDelete(`/api/targets/${id}`);

/** Quick change without the wizard: name, use, default. */
export const patchTarget = (id: string, body: PatchTargetRequest) =>
  apiPatch(`/api/targets/${id}`, body, targetResponseSchema).then((r) => r.target);

/** Tests a (maybe unsaved) location and lists one folder. */
export const probeTarget = (target: SaveTargetRequest, path: string, id?: string) =>
  apiPost('/api/targets/probe', { target, path, ...(id && { id }) }, browseResponseSchema);

export const browseTarget = (id: string, path: string): Promise<BrowseResponse> =>
  apiGet(`/api/targets/${id}/browse?path=${encodeURIComponent(path)}`, browseResponseSchema);

export const makeFolder = (id: string, path: string, name: string) =>
  apiPost(`/api/targets/${id}/mkdir`, { path, name });

/** A new folder while the location is still being set up (not saved yet). */
export const makeFolderDraft = (
  target: SaveTargetRequest,
  path: string,
  name: string,
  id?: string,
) => apiPost('/api/targets/probe/mkdir', { target, path, name, ...(id && { id }) });

/**
 * Saves a result to storage locations. A result made on the server is copied
 * there directly; anything else goes to the server first (browser results
 * never were there), then the server copies it on.
 */
export async function saveToTargets(
  blob: Blob,
  fileName: string,
  targetIds: string[],
  folder: string | undefined,
  onUpload?: (fraction: number) => void,
): Promise<ExportResult[]> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const body = {
    targetIds,
    name: fileName,
    ...(folder !== undefined && { folder }),
    ...(getFormat(ext) && { category: getFormat(ext)?.category }),
  };
  const jobId = serverJobOf(blob);
  if (jobId) {
    try {
      const res = await apiPost(`/api/jobs/${jobId}/export`, body, exportResponseSchema);
      onUpload?.(1);
      return res.results;
    } catch (error) {
      // Tidied away on the server (after the cleanup time): upload it after all.
      if (!(error instanceof ApiRequestError) || (error.status !== 404 && error.status !== 410)) {
        throw error;
      }
    }
  }
  let fileId: string;
  try {
    fileId = await uploadToServer(blob, fileName, undefined, onUpload ?? (() => undefined));
  } catch (error) {
    if (error instanceof ConversionError) {
      throw new ApiRequestError(0, error.messageKey, error.details);
    }
    throw error;
  }
  const res = await apiPost(`/api/files/${fileId}/export`, body, exportResponseSchema);
  return res.results;
}

/** Copies files from a location to the server and returns them as File objects. */
export async function openFromTarget(id: string, paths: string[]): Promise<File[]> {
  const res = await apiPost(`/api/targets/${id}/import`, { paths }, importResponseSchema);
  return Promise.all(
    res.files.map(async (f) => {
      const response = await fetch(`/api/files/${f.fileId}/content`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new ApiRequestError(response.status, 'errors.resultGone');
      const blob = await response.blob();
      const file = new File([blob], f.name, { type: blob.type });
      // It is on the server already: converting it there needs no new upload.
      rememberServerFile(file, f.fileId);
      return file;
    }),
  );
}

/** One file of a location, only to look at it (preview while choosing). */
export async function fetchTargetFile(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(`/api/targets/${id}/file?path=${encodeURIComponent(path)}`, {
    credentials: 'same-origin',
    ...(signal && { signal }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { messageKey?: string; details?: string };
    } | null;
    throw new ApiRequestError(
      response.status,
      body?.error?.messageKey ?? 'errors.network',
      body?.error?.details,
    );
  }
  return response.blob();
}
