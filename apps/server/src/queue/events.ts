import { EventEmitter } from 'node:events';
import type {
  BooruJobDto,
  DownloadDto,
  JobDto,
  NotificationDto,
  WorkflowRunDto,
} from '@conbert/schemas';
import type { JobRecord } from '../db/schema';

/** Converts a job row to what the API returns. */
export function toJobDto(job: JobRecord): JobDto {
  return {
    id: job.id,
    fileId: job.fileId,
    inputExt: job.inputExt,
    outputExt: job.outputExt,
    steps: job.steps as JobDto['steps'],
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.errorKey
      ? { messageKey: job.errorKey, ...(job.errorDetails ? { details: job.errorDetails } : {}) }
      : null,
    resultName: job.resultName,
    resultSize: job.resultSize,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

interface JobEventMap {
  job: [userId: string, job: JobDto];
  download: [userId: string, download: DownloadDto];
  booru: [userId: string, job: BooruJobDto];
  workflow: [userId: string, run: WorkflowRunDto];
  notification: [userId: string, notification: NotificationDto];
}

/** In-process events for job changes; the WebSocket route forwards them to the owner. */
export class JobEvents extends EventEmitter<JobEventMap> {
  constructor() {
    super();
    // One listener per open browser tab.
    this.setMaxListeners(0);
  }
}
