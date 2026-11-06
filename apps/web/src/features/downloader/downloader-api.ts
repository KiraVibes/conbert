import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cookiesResponseSchema,
  deviantartLoginStartResponseSchema,
  deviantartStatusSchema,
  downloadResponseSchema,
  downloaderToolsResponseSchema,
  downloadsResponseSchema,
  pixivLoginStartResponseSchema,
  pixivLoginStatusSchema,
  probeDownloadResponseSchema,
  type CreateDownloadRequest,
  type DownloadDto,
  type DownloadedFile,
} from '@conbert/schemas';
import { ApiRequestError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { subscribeToDownloads } from '@/lib/job-socket';

export const DOWNLOADS_KEY = ['downloads'] as const;
export const COOKIES_KEY = ['downloader-cookies'] as const;
export const TOOLS_KEY = ['downloader-tools'] as const;
export const PIXIV_KEY = ['downloader-pixiv'] as const;
export const DEVIANTART_KEY = ['downloader-deviantart'] as const;

/** The own downloads, kept live over the WebSocket (polling as a fallback). */
export function useDownloads(onUpdate?: (download: DownloadDto) => void) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DOWNLOADS_KEY,
    queryFn: ({ signal }) => apiGet('/api/downloader/jobs', downloadsResponseSchema, { signal }),
    select: (data) => data.downloads,
    // Some proxies block WebSockets: look again now and then while something runs.
    refetchInterval: (q) =>
      q.state.data?.downloads.some((d) => d.status === 'queued' || d.status === 'running')
        ? 3_000
        : false,
  });
  useEffect(
    () =>
      subscribeToDownloads((download) => {
        queryClient.setQueryData<{ downloads: DownloadDto[] }>(DOWNLOADS_KEY, (old) => {
          const list = old?.downloads ?? [];
          // A subscription check without anything new disappears on the server too.
          if (download.feedId && download.status === 'done' && download.files.length === 0) {
            return { downloads: list.filter((d) => d.id !== download.id) };
          }
          const exists = list.some((d) => d.id === download.id);
          return {
            downloads: exists
              ? list.map((d) => (d.id === download.id ? download : d))
              : [download, ...list],
          };
        });
        onUpdate?.(download);
      }),
    [queryClient, onUpdate],
  );
  return query;
}

export const probeLink = (url: string) =>
  apiPost('/api/downloader/probe', { url }, probeDownloadResponseSchema);

export const startDownload = (body: CreateDownloadRequest) =>
  apiPost('/api/downloader/jobs', body, downloadResponseSchema).then((r) => r.download);

/** Cancels a running download or removes a finished one from the list. */
export const cancelOrRemove = (id: string) => apiDelete(`/api/downloader/jobs/${id}`);

/** Loads the downloaded files into the browser (for the conversion list). */
export async function fetchDownloadedFiles(files: DownloadedFile[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const response = await fetch(`/api/files/${f.fileId}/content`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new ApiRequestError(response.status, 'errors.resultGone');
      const blob = await response.blob();
      // The browser has it now: free the server's disk right away (small hosts).
      void apiDelete(`/api/files/${f.fileId}`).catch(() => undefined);
      return new File([blob], f.name, { type: blob.type });
    }),
  );
}

export function useCookies() {
  return useQuery({
    queryKey: COOKIES_KEY,
    queryFn: ({ signal }) => apiGet('/api/downloader/cookies', cookiesResponseSchema, { signal }),
    select: (data) => data.cookies,
  });
}

export const saveCookies = (platform: string, content: string) =>
  apiPut(`/api/downloader/cookies/${platform}`, { content });

export const deleteCookies = (platform: string) => apiDelete(`/api/downloader/cookies/${platform}`);

export function useDownloaderTools() {
  return useQuery({
    queryKey: TOOLS_KEY,
    queryFn: ({ signal }) =>
      apiGet('/api/downloader/tools', downloaderToolsResponseSchema, { signal }),
    staleTime: 60_000,
  });
}

export const updateDownloaderTools = () =>
  apiPost('/api/downloader/tools/update', {}, downloaderToolsResponseSchema);

/** Downloaded files already put into the list (per browser). */
const TAKEN_KEY = 'conbert-downloads-taken';
/** Also in memory: storage may be blocked, and files must never be added twice. */
const takenInMemory = new Set<string>();

export function takenFiles(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(TAKEN_KEY) ?? '[]') as string[];
    return new Set([...stored, ...takenInMemory]);
  } catch {
    return new Set(takenInMemory);
  }
}

export function markTaken(id: string): void {
  takenInMemory.add(id);
  try {
    const ids = [...takenFiles(), id].slice(-2000);
    localStorage.setItem(TAKEN_KEY, JSON.stringify(ids));
  } catch {
    // Without storage the button simply stays available.
  }
}

// --- Pixiv login ---
export function usePixivLogin() {
  return useQuery({
    queryKey: PIXIV_KEY,
    queryFn: ({ signal }) => apiGet('/api/downloader/pixiv', pixivLoginStatusSchema, { signal }),
  });
}

/** The address of Pixiv's own login page (fresh each time). */
export const startPixivLogin = () =>
  apiPost('/api/downloader/pixiv/login', {}, pixivLoginStartResponseSchema);

export const sendPixivCode = (code: string) =>
  apiPost('/api/downloader/pixiv/code', { code }, pixivLoginStatusSchema);

export const savePixivToken = (refreshToken: string) =>
  apiPut('/api/downloader/pixiv/token', { refreshToken }, pixivLoginStatusSchema);

export const deletePixivLogin = () => apiDelete('/api/downloader/pixiv');

// --- DeviantArt: your own app + login ---
export function useDeviantart() {
  return useQuery({
    queryKey: DEVIANTART_KEY,
    queryFn: ({ signal }) =>
      apiGet('/api/downloader/deviantart', deviantartStatusSchema, { signal }),
  });
}

export const saveDeviantartApp = (clientId: string, clientSecret: string) =>
  apiPut('/api/downloader/deviantart/app', { clientId, clientSecret }, deviantartStatusSchema);

/** The address of DeviantArt's own login page (fresh each time). */
export const startDeviantartLogin = () =>
  apiPost('/api/downloader/deviantart/login', {}, deviantartLoginStartResponseSchema);

export const sendDeviantartCode = (code: string) =>
  apiPost('/api/downloader/deviantart/code', { code }, deviantartStatusSchema);

/** Logs out; with `everything`, the app is forgotten too. */
export const deleteDeviantart = (everything: boolean) =>
  apiDelete(`/api/downloader/deviantart${everything ? '?all=1' : ''}`);
