import {
  wsServerMessageSchema,
  type BooruJobDto,
  type DownloadDto,
  type JobDto,
  type NotificationDto,
  type WorkflowRunDto,
} from '@conbert/schemas';

type Listener = (job: JobDto) => void;

const listeners = new Map<string, Set<Listener>>();
const downloadListeners = new Set<(download: DownloadDto) => void>();
const booruListeners = new Set<(job: BooruJobDto) => void>();
const workflowListeners = new Set<(run: WorkflowRunDto) => void>();
const notificationListeners = new Set<(n: NotificationDto) => void>();
let socket: WebSocket | null = null;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function url(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

function hasListeners(): boolean {
  return (
    listeners.size > 0 ||
    downloadListeners.size > 0 ||
    booruListeners.size > 0 ||
    workflowListeners.size > 0 ||
    notificationListeners.size > 0
  );
}

function connect(): void {
  if (socket || typeof WebSocket === 'undefined') return;
  const ws = new WebSocket(url());
  socket = ws;
  ws.addEventListener('open', () => {
    retry = 0;
  });
  ws.addEventListener('message', (event) => {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const message = wsServerMessageSchema.safeParse(data);
    if (!message.success) return;
    if (message.data.type === 'download') {
      const download = message.data.download;
      downloadListeners.forEach((listener) => listener(download));
      return;
    }
    if (message.data.type === 'workflow') {
      const run = message.data.run;
      workflowListeners.forEach((listener) => listener(run));
      return;
    }
    if (message.data.type === 'notification') {
      const notification = message.data.notification;
      notificationListeners.forEach((listener) => listener(notification));
      return;
    }
    if (message.data.type === 'booru') {
      const booruJob = message.data.job;
      booruListeners.forEach((listener) => listener(booruJob));
      return;
    }
    if (message.data.type !== 'job') return;
    const job = message.data.job;
    listeners.get(job.id)?.forEach((listener) => listener(job));
  });
  ws.addEventListener('close', () => {
    socket = null;
    // Reconnect with backoff while someone is still waiting for a job.
    if (!hasListeners()) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    reconnectTimer = setTimeout(connect, delay);
  });
}

/**
 * Live updates for one job over the shared WebSocket. The connection opens
 * on the first subscription and closes shortly after the last one ends.
 */
export function subscribeToJob(jobId: string, listener: Listener): () => void {
  clearTimeout(closeTimer);
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  connect();
  return () => {
    const current = listeners.get(jobId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(jobId);
    if (!hasListeners()) {
      closeTimer = setTimeout(() => {
        if (hasListeners()) return;
        clearTimeout(reconnectTimer);
        socket?.close();
        socket = null;
      }, 5_000);
    }
  };
}

function scheduleClose(): void {
  if (hasListeners()) return;
  closeTimer = setTimeout(() => {
    if (hasListeners()) return;
    clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
  }, 5_000);
}

/** Live updates of all own downloads (the downloader page listens while open). */
export function subscribeToDownloads(listener: (download: DownloadDto) => void): () => void {
  clearTimeout(closeTimer);
  downloadListeners.add(listener);
  connect();
  return () => {
    downloadListeners.delete(listener);
    scheduleClose();
  };
}

/** Live updates of all own booru crawls (the booru page listens while open). */
export function subscribeToBooru(listener: (job: BooruJobDto) => void): () => void {
  clearTimeout(closeTimer);
  booruListeners.add(listener);
  connect();
  return () => {
    booruListeners.delete(listener);
    scheduleClose();
  };
}

/** Live updates of workflow runs (the app listens while signed in). */
export function subscribeToWorkflows(listener: (run: WorkflowRunDto) => void): () => void {
  clearTimeout(closeTimer);
  workflowListeners.add(listener);
  connect();
  return () => {
    workflowListeners.delete(listener);
    scheduleClose();
  };
}

/** Browser notifications sent by the server. */
export function subscribeToNotifications(listener: (n: NotificationDto) => void): () => void {
  clearTimeout(closeTimer);
  notificationListeners.add(listener);
  connect();
  return () => {
    notificationListeners.delete(listener);
    scheduleClose();
  };
}
