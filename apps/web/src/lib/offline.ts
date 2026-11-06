/**
 * Talks to the service worker (public/sw.js) about offline use: how much of
 * the app is stored, and downloading the rest ("prepare for offline").
 */

export interface OfflineStatus {
  /** false: no build manifest (dev server) – offline storage isn't possible. */
  available: boolean;
  files?: number;
  cachedFiles?: number;
  bytes?: number;
  cachedBytes?: number;
}

type WorkerReply =
  | { type: 'conbert-offline-status'; status: OfflineStatus }
  | { type: 'conbert-offline-progress'; doneBytes: number; bytes: number }
  | { type: 'conbert-offline-done'; status: OfflineStatus }
  | { type: 'conbert-offline-error'; error: string };

/** null when there's no service worker (no HTTPS/localhost, or the dev server). */
export async function offlineWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.active ?? (await navigator.serviceWorker.ready).active;
}

function ask(
  worker: ServiceWorker,
  type: string,
  onMessage: (reply: WorkerReply) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.type === 'conbert-offline-error') {
        channel.port1.close();
        reject(new Error(reply.error));
      } else if (onMessage(reply)) {
        channel.port1.close();
        resolve();
      }
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export async function getOfflineStatus(): Promise<OfflineStatus | null> {
  const worker = await offlineWorker();
  if (!worker) return null;
  let result: OfflineStatus = { available: false };
  await ask(worker, 'conbert-offline-status', (reply) => {
    if (reply.type !== 'conbert-offline-status') return false;
    result = reply.status;
    return true;
  });
  return result;
}

/** Downloads every file of the app that isn't stored yet. */
export async function prepareOffline(
  onProgress: (doneBytes: number, bytes: number) => void,
): Promise<OfflineStatus> {
  const worker = await offlineWorker();
  if (!worker) throw new Error('no service worker');
  let result: OfflineStatus = { available: false };
  await ask(worker, 'conbert-offline-prepare', (reply) => {
    if (reply.type === 'conbert-offline-progress') onProgress(reply.doneBytes, reply.bytes);
    if (reply.type !== 'conbert-offline-done') return false;
    result = reply.status;
    return true;
  });
  return result;
}

/** Removes the stored files (they come back on use). */
export async function clearOffline(): Promise<OfflineStatus | null> {
  const worker = await offlineWorker();
  if (!worker) return null;
  let result: OfflineStatus = { available: false };
  await ask(worker, 'conbert-offline-clear', (reply) => {
    if (reply.type !== 'conbert-offline-status') return false;
    result = reply.status;
    return true;
  });
  return result;
}
