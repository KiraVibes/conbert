import type { Engine } from '@conbert/core';
import type { Config } from './config';
import type { Db } from './db';
import type { SecretBox } from './lib/secret-box';
import type { LdapConnector } from './auth/ldap/client';
import type { RcloneSetup } from './targets/rclone';
import type { DownloadRunner } from './downloader/runner';
import type { BooruRunner } from './booru/crawler';
import type { WorkflowRunner } from './workflows/executor';
import type { JobEvents } from './queue/events';
import type { JobQueue } from './queue/job-queue';
import type { JobRunner } from './queue/runner';

/** Everything route handlers and workers need, passed around explicitly. */
export interface AppContext {
  config: Config;
  db: Db;
  engines: readonly Engine[];
  /** One-time code required by the first-start setup page. */
  setupCode: string;
  /** Encrypts stored credentials (storage locations …). */
  secrets: SecretBox;
  /** Opens LDAP connections (a fake in tests). */
  ldap: LdapConnector;
  /** How storage locations reach rclone. */
  rclone: RcloneSetup;
  /** Server-side conversion jobs (set up right after the context is created). */
  jobs: {
    queue: JobQueue;
    runner: JobRunner;
    events: JobEvents;
  };
  /** Social-media downloads (own queue, so long downloads never block conversions). */
  downloads: {
    queue: JobQueue;
    runner: DownloadRunner;
  };
  /** Booru crawls (own queue; slow crawls can run for hours). */
  booru: {
    queue: JobQueue;
    runner: BooruRunner;
  };
  /** Workflow runs (own queue, one at a time). */
  workflows: {
    queue: JobQueue;
    runner: WorkflowRunner;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The app context (config, database, engines …). */
    conbert: AppContext;
  }
}
