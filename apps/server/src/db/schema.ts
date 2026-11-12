import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Timestamps are stored as Unix milliseconds. */
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Lowercase login name, unique. */
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  /** Argon2id hash in PHC format. Null for users that only log in via reverse proxy. */
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  /**
   * How much the user may keep on the server at once (uploads, results,
   * downloads), in bytes. Null = the default for everyone; -1 = no limit.
   */
  quotaBytes: integer('quota_bytes'),
  /** Where the account comes from. LDAP and proxy users have no password here. */
  authSource: text('auth_source', { enum: ['local', 'ldap', 'proxy'] })
    .notNull()
    .default('local'),
  /** Distinguished name in LDAP (LDAP users only). */
  ldapDn: text('ldap_dn'),
  /** The user's own allow/deny per function: { downloader: 'deny', … }. */
  permissionOverrides: text('permission_overrides', { mode: 'json' })
    .$type<Partial<Record<string, 'allow' | 'deny'>>>()
    .notNull()
    .default(sql`'{}'`),
  /** LDAP no longer knows this user: no sign-in until they show up again. */
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

/** User groups. Functions are allowed per group (see packages/schemas permissions). */
export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** 'everyone' = built-in group, every user is a member without a row. */
    builtin: text('builtin', { enum: ['everyone'] }),
    /** { downloader: true, booru: false, … } – missing = not allowed (everyone: allowed). */
    permissions: text('permissions', { mode: 'json' })
      .$type<Partial<Record<string, boolean>>>()
      .notNull()
      .default(sql`'{}'`),
    /** Members from LDAP/proxy become administrators. */
    grantsAdmin: integer('grants_admin', { mode: 'boolean' }).notNull().default(false),
    /** Imported LDAP group (distinguished name). */
    ldapDn: text('ldap_dn'),
    /** Group name in the reverse proxy's groups header. */
    proxyName: text('proxy_name'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('groups_name_idx').on(t.name),
    uniqueIndex('groups_ldap_dn_idx').on(t.ldapDn),
    uniqueIndex('groups_builtin_idx').on(t.builtin),
  ],
);
export type Group = typeof groups.$inferSelect;

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who put the user there: the admin by hand, the LDAP sync or the proxy header. */
    source: text('source', { enum: ['manual', 'ldap', 'proxy'] })
      .notNull()
      .default('manual'),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_members_user_idx').on(t.userId),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token – the token itself is only in the cookie. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * API tokens for scripts and the CLI ("Authorization: Bearer cbt_…"). Only
 * the SHA-256 of a token is stored; the token itself is shown once.
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** The first characters, so the user can tell tokens apart. */
    prefix: text('prefix').notNull(),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('api_tokens_hash_idx').on(t.tokenHash),
    index('api_tokens_user_idx').on(t.userId),
  ],
);
export type ApiTokenRecord = typeof apiTokens.$inferSelect;

/** App-wide key/value settings (e.g. whether the first-start setup is done). */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/** Per-user UI settings (theme, language, expert mode …) as JSON. */
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Uploaded files, owned by one user. */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    /** Detected via magic bytes, falls back to the name. */
    ext: text('ext').notNull(),
    mime: text('mime'),
    size: integer('size').notNull(),
    /** Absolute path below the data directory (UUID-based, never the user's name). */
    path: text('path').notNull(),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Set = kept in the user's server archive (downloads without a storage
     * location) until expiresAt; the value names where it came from.
     */
    archivedFrom: text('archived_from'),
  },
  (t) => [index('files_user_idx').on(t.userId), index('files_expires_idx').on(t.expiresAt)],
);

export const JOB_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),
    mode: text('mode', { enum: ['convert', 'compress', 'ocr'] })
      .notNull()
      .default('convert'),
    inputExt: text('input_ext').notNull(),
    outputExt: text('output_ext').notNull(),
    /** Route as chosen by the router: [{ engineId, from, to }, …]. */
    steps: text('steps', { mode: 'json' }).notNull(),
    options: text('options', { mode: 'json' }).notNull(),
    /** Files for options of type 'file': { optionKey: fileId }. */
    attachments: text('attachments', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    stage: text('stage'),
    errorKey: text('error_key'),
    errorDetails: text('error_details'),
    resultPath: text('result_path'),
    resultName: text('result_name'),
    resultSize: integer('result_size'),
    createdAt: createdAt(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('jobs_user_idx').on(t.userId), index('jobs_expires_idx').on(t.expiresAt)],
);

/** External storage locations (NAS, SFTP, WebDAV, S3, local folders), one owner each. */
export const storageTargets = sqliteTable(
  'storage_targets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    basePath: text('base_path').notNull().default(''),
    asTarget: integer('as_target', { mode: 'boolean' }).notNull().default(true),
    asSource: integer('as_source', { mode: 'boolean' }).notNull().default(true),
    conflictPolicy: text('conflict_policy', { enum: ['rename', 'overwrite', 'skip'] })
      .notNull()
      .default('rename'),
    subfolderPattern: text('subfolder_pattern').notNull().default(''),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    /** Non-secret settings (host, user, URL …) as JSON. */
    settings: text('settings', { mode: 'json' }).notNull(),
    /** Passwords and keys: JSON, encrypted with AES-256-GCM (see lib/secret-box). */
    secrets: text('secrets'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('storage_targets_user_idx').on(t.userId)],
);

export const DOWNLOAD_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;

/** Social-media downloads (yt-dlp, gallery-dl), one owner each. */
export const downloads = sqliteTable(
  'downloads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    platform: text('platform').notNull(),
    tool: text('tool', { enum: ['yt-dlp', 'gallery-dl'] }).notNull(),
    kind: text('kind', { enum: ['single', 'playlist', 'profile'] }).notNull(),
    title: text('title'),
    /** quality, parts, limit, dates, sleep – as validated by the API. */
    options: text('options', { mode: 'json' }).notNull(),
    status: text('status', { enum: DOWNLOAD_STATUSES }).notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    done: integer('done').notNull().default(0),
    total: integer('total'),
    /** [{ fileId, name, ext, size }] – the files as uploads (expire like them). */
    files: text('files', { mode: 'json' }).notNull(),
    skipped: integer('skipped').notNull().default(0),
    /** Items skipped because they had been downloaded before (download archive). */
    known: integer('known').notNull().default(0),
    savedTo: text('saved_to'),
    errorKey: text('error_key'),
    errorDetails: text('error_details'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    /** Started by a subscription check (download_feeds). */
    feedId: text('feed_id'),
  },
  (t) => [index('downloads_user_idx').on(t.userId)],
);

/**
 * Downloader subscriptions: a profile, channel or thread checked regularly;
 * the tools' download archive (data/feeds/<id>.*) remembers what was there.
 */
export const downloadFeeds = sqliteTable(
  'download_feeds',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    platform: text('platform').notNull(),
    tool: text('tool', { enum: ['yt-dlp', 'gallery-dl'] }).notNull(),
    kind: text('kind', { enum: ['single', 'playlist', 'profile'] }).notNull(),
    title: text('title'),
    name: text('name').notNull().default(''),
    intervalMinutes: integer('interval_minutes').notNull().default(360),
    paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
    /** A thread that is gone – nothing more will come. */
    ended: integer('ended', { mode: 'boolean' }).notNull().default(false),
    /** Skip what was there when subscribing. */
    onlyNew: integer('only_new', { mode: 'boolean' }).notNull().default(true),
    /** The first check went through (the archive knows the old items). */
    initialized: integer('initialized', { mode: 'boolean' }).notNull().default(false),
    /** quality, parts, limit, sleepSeconds, targetIds, toList, after, notify. */
    options: text('options', { mode: 'json' }).notNull(),
    lastCheckAt: integer('last_check_at', { mode: 'timestamp_ms' }),
    nextCheckAt: integer('next_check_at', { mode: 'timestamp_ms' }),
    lastNew: integer('last_new').notNull().default(0),
    /** Last check that loaded something. */
    lastFoundAt: integer('last_found_at', { mode: 'timestamp_ms' }),
    totalLoaded: integer('total_loaded').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('download_feeds_user_idx').on(t.userId)],
);
export type DownloadFeedRecord = typeof downloadFeeds.$inferSelect;

/**
 * One age key pair per account. The private key arrives already locked with
 * the vault password (made in the browser); the server can't open it.
 */
export const userKeys = sqliteTable('user_keys', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  /** ASCII-armored age file, locked with a password (scrypt). */
  lockedIdentity: text('locked_identity').notNull(),
  /** Other users of this Conbert may encrypt files for this account. */
  shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export type UserKeyRecord = typeof userKeys.$inferSelect;

/** cookies.txt per user and platform, encrypted (see lib/secret-box), never sent back. */
export const downloaderCookies = sqliteTable(
  'downloader_cookies',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    content: text('content').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.platform] })],
);

export type DownloadRecord = typeof downloads.$inferSelect;

// --- Booru ---

/** Booru settings per user – enforced on the server (ratings, blacklist, names). */
export const booruSettings = sqliteTable('booru_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).notNull(),
  /** Argon2id hash of the PIN that protects the rating choice. */
  lockHash: text('lock_hash'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Own booru instances (Danbooru-, Gelbooru-, e621- or Moebooru-API + address). */
export const booruInstances = sqliteTable(
  'booru_instances',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    api: text('api', { enum: ['danbooru', 'gelbooru', 'e621', 'moebooru'] }).notNull(),
    baseUrl: text('base_url').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('booru_instances_user_idx').on(t.userId)],
);

/** Username + API key per user and site; the key is encrypted (lib/secret-box). */
export const booruAccounts = sqliteTable(
  'booru_accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    username: text('username').notNull(),
    apiKey: text('api_key').notNull(),
    /** Own tag limit (e.g. Danbooru Gold). */
    tagLimit: integer('tag_limit'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId] })],
);

export const BOORU_JOB_STATUSES = [
  'queued',
  'running',
  'waiting',
  'paused',
  'done',
  'error',
  'cancelled',
] as const;

/** Booru crawls; the state (last ID, counts) is saved so they can go on after a restart. */
export const booruJobs = sqliteTable(
  'booru_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    query: text('query').notNull(),
    /** As validated by the API (limit, speed, window, names, destinations …). */
    options: text('options', { mode: 'json' }).notNull(),
    status: text('status', { enum: BOORU_JOB_STATUSES }).notNull().default('queued'),
    /** Cursor, counts, recent files (see booru/crawler). */
    state: text('state', { mode: 'json' }).notNull(),
    subscriptionId: text('subscription_id'),
    resumeAt: integer('resume_at', { mode: 'timestamp_ms' }),
    errorKey: text('error_key'),
    errorDetails: text('error_details'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('booru_jobs_user_idx').on(t.userId), index('booru_jobs_status_idx').on(t.status)],
);

/** Download archive: posts already loaded (skipped next time; MD5 across sites). */
export const booruArchive = sqliteTable(
  'booru_archive',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    postId: integer('post_id').notNull(),
    md5: text('md5'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.siteId, t.postId] }),
    index('booru_archive_md5_idx').on(t.userId, t.md5),
  ],
);

/** Tag subscriptions: a saved search checked regularly for new posts. */
export const booruSubscriptions = sqliteTable(
  'booru_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    query: text('query').notNull(),
    name: text('name').notNull().default(''),
    intervalHours: integer('interval_hours').notNull().default(24),
    paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
    /** limit, targetIds, workflowId, notify. */
    options: text('options', { mode: 'json' }).notNull(),
    /** Highest post ID seen – only newer posts are loaded. */
    lastPostId: integer('last_post_id'),
    lastCheckAt: integer('last_check_at', { mode: 'timestamp_ms' }),
    nextCheckAt: integer('next_check_at', { mode: 'timestamp_ms' }),
    lastNew: integer('last_new').notNull().default(0),
    /** Last check that loaded something. */
    lastFoundAt: integer('last_found_at', { mode: 'timestamp_ms' }),
    totalLoaded: integer('total_loaded').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('booru_subscriptions_user_idx').on(t.userId)],
);

export type BooruJobRecord = typeof booruJobs.$inferSelect;
export type BooruSubscriptionRecord = typeof booruSubscriptions.$inferSelect;

export type User = typeof users.$inferSelect;
export type StorageTargetRecord = typeof storageTargets.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type JobRecord = typeof jobs.$inferSelect;

// --- Workflows & notifications ---

/** Saved workflows (a list of steps), one owner each. */
export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    steps: text('steps', { mode: 'json' }).notNull(),
    keepOriginal: integer('keep_original', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('workflows_user_idx').on(t.userId)],
);

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;

/** One run of a workflow over some files; the steps are copied, so edits don't matter. */
export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workflowId: text('workflow_id'),
    name: text('name').notNull(),
    steps: text('steps', { mode: 'json' }).notNull(),
    keepOriginal: integer('keep_original', { mode: 'boolean' }).notNull().default(false),
    test: integer('test', { mode: 'boolean' }).notNull().default(false),
    toList: integer('to_list', { mode: 'boolean' }).notNull().default(true),
    /** Delete the input files afterwards (downloads that only went through the workflow). */
    dropInputs: integer('drop_inputs', { mode: 'boolean' }).notNull().default(false),
    fileIds: text('file_ids', { mode: 'json' }).notNull(),
    status: text('status', { enum: WORKFLOW_RUN_STATUSES }).notNull().default('queued'),
    /** One entry per input file (see schemas workflowRunFileSchema). */
    results: text('results', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('workflow_runs_user_idx').on(t.userId)],
);

/** Notification channels (ntfy, Gotify, Discord, Telegram, e-mail, browser). */
export const notificationChannels = sqliteTable(
  'notification_channels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    settings: text('settings', { mode: 'json' }).notNull(),
    /** Tokens, webhook addresses, passwords: JSON, encrypted (lib/secret-box). */
    secrets: text('secrets'),
    events: text('events', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('notification_channels_user_idx').on(t.userId)],
);

export type WorkflowRecord = typeof workflows.$inferSelect;
export type WorkflowRunRecord = typeof workflowRuns.$inferSelect;
export type NotificationChannelRecord = typeof notificationChannels.$inferSelect;

/**
 * Media index: what Conbert found on a storage location (the default one).
 * Entries are only added or updated by a sync – never removed, so a file that
 * was deleted or moved elsewhere is still known and never downloaded again.
 */
export const mediaItems = sqliteTable(
  'media_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => storageTargets.id, { onDelete: 'cascade' }),
    /** Relative to the location's base folder, e.g. "Instagram/KawaiiQueen/a.jpg". */
    path: text('path').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    modTime: text('mod_time'),
    kind: text('kind', { enum: ['image', 'gif', 'video', 'other'] }).notNull(),
    /** "yt-dlp youtube <id>" or "booru <site> <post>" when the name tells it. */
    itemKey: text('item_key'),
    sha256: text('sha256'),
    /** Similar pictures: 64-bit dHash as hex, '' when the picture couldn't be read. */
    phash: text('phash'),
    width: integer('width'),
    height: integer('height'),
    status: text('status', { enum: ['present', 'kept', 'favorite', 'premium', 'deleted'] })
      .notNull()
      .default('present'),
    foundAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    sortedAt: integer('sorted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('media_items_path_idx').on(t.targetId, t.path),
    index('media_items_status_idx').on(t.userId, t.status),
    index('media_items_name_idx').on(t.userId, t.name, t.size),
    index('media_items_sha_idx').on(t.userId, t.sha256),
  ],
);

/**
 * Swipe decisions. The newest five stay "pending" (undo is possible); an
 * older one is carried out – only then is a file really deleted or moved.
 */
export const swipeActions = sqliteTable(
  'swipe_actions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    action: text('action', {
      enum: ['delete', 'keep', 'favorite', 'unfavorite', 'premium', 'deletePost'],
    }).notNull(),
    createdAt: createdAt(),
    committedAt: integer('committed_at', { mode: 'timestamp_ms' }),
    /** Why carrying it out failed (shown, then the action is dropped). */
    error: text('error'),
  },
  (t) => [index('swipe_actions_user_idx').on(t.userId, t.committedAt)],
);

export type MediaItemRecord = typeof mediaItems.$inferSelect;
export type SwipeActionRecord = typeof swipeActions.$inferSelect;
