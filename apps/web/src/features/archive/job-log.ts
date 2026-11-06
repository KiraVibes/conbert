import { useEffect } from 'react';
import { create } from 'zustand';
import type { ExecutionMode, Runtime } from '@conbert/core';
import { createId } from '@/lib/id';
import type { CompressChoice, FileItem, FileTask } from '@/features/convert/files-store';

/**
 * The history ("Verlauf"): every conversion and compression with the settings
 * it used, also the ones that failed. Only the settings are kept, never the
 * files – so it stays small and can be kept much longer than the archive.
 * It lives in this browser's localStorage, one list per account.
 */
export interface JobRecord {
  id: string;
  createdAt: number;
  task: FileTask;
  sourceName: string;
  sourceExt: string;
  sourceSize: number;
  targetExt: string;
  /** What the person picked: on this device, on the server or automatic. */
  mode: ExecutionMode;
  /** Where it ran in the end (missing when no route was found). */
  runtime?: Runtime;
  /** Engines of the route, first to last. */
  engineIds: string[];
  options: Record<string, unknown>;
  compress?: CompressChoice;
  status: 'done' | 'error';
  errorKey?: string;
  resultSize?: number;
  keptOriginal?: boolean;
  durationMs?: number;
}

export const JOB_LOG_DAYS = 90;
export const JOB_LOG_MAX = 300;
const MAX_AGE_MS = JOB_LOG_DAYS * 24 * 60 * 60 * 1000;

interface JobLogState {
  records: JobRecord[];
  add: (record: JobRecord) => void;
  remove: (id: string) => void;
  clear: () => void;
  replaceAll: (records: JobRecord[]) => void;
}

/** Newest first, at most JOB_LOG_MAX entries and JOB_LOG_DAYS days. */
export function trimRecords(records: readonly JobRecord[], now = Date.now()): JobRecord[] {
  return records
    .filter((r) => now - r.createdAt < MAX_AGE_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, JOB_LOG_MAX);
}

export const useJobLog = create<JobLogState>()((set) => ({
  records: [],
  add: (record) =>
    set((s) => ({
      records: trimRecords([record, ...s.records.filter((r) => r.id !== record.id)]),
    })),
  remove: (id) => {
    sessionFiles.delete(id);
    set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
  },
  clear: () => {
    sessionFiles.clear();
    set({ records: [] });
  },
  replaceAll: (records) => set({ records: trimRecords(records) }),
}));

/**
 * The original files of jobs from this visit, so "again" works without
 * picking the file once more. Never stored – gone after a reload.
 */
const sessionFiles = new Map<string, File>();

export function sessionFile(recordId: string): File | undefined {
  return sessionFiles.get(recordId);
}

export interface JobOutcome {
  runtime?: Runtime;
  engineIds?: readonly string[];
  options: Record<string, unknown>;
  startedAt: number;
  error?: string;
  resultSize?: number;
  keptOriginal?: boolean;
}

/** Notes one finished or failed job in the history. */
export function recordJob(item: FileItem, outcome: JobOutcome): void {
  if (!item.targetExt) return;
  const id = createId();
  sessionFiles.set(id, item.file);
  // Option values are plain JSON (numbers, strings, booleans); anything else is dropped.
  const options = JSON.parse(JSON.stringify(outcome.options)) as Record<string, unknown>;
  useJobLog.getState().add({
    id,
    createdAt: Date.now(),
    task: item.task,
    sourceName: item.name,
    sourceExt: item.ext,
    sourceSize: item.file.size,
    targetExt: item.targetExt,
    mode: item.mode,
    ...(outcome.runtime && { runtime: outcome.runtime }),
    engineIds: [...(outcome.engineIds ?? [])],
    options,
    ...(item.task === 'compress' && { compress: { ...item.compress } }),
    status: outcome.error ? 'error' : 'done',
    ...(outcome.error && { errorKey: outcome.error }),
    ...(outcome.resultSize !== undefined && { resultSize: outcome.resultSize }),
    ...(outcome.keptOriginal && { keptOriginal: true }),
    durationMs: Date.now() - outcome.startedAt,
  });
}

function storageKey(userId: string) {
  return `conbert-joblog-${userId}`;
}

function isRecord(value: unknown): value is JobRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<JobRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.createdAt === 'number' &&
    (r.task === 'convert' || r.task === 'compress') &&
    typeof r.sourceName === 'string' &&
    typeof r.targetExt === 'string' &&
    (r.status === 'done' || r.status === 'error') &&
    Array.isArray(r.engineIds) &&
    typeof r.options === 'object' &&
    r.options !== null
  );
}

export function loadJobLog(userId: string): JobRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? trimRecords(parsed.filter(isRecord)) : [];
  } catch {
    return [];
  }
}

function saveJobLog(userId: string, records: readonly JobRecord[]): void {
  try {
    if (records.length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(records));
  } catch {
    // Storage full or blocked: the history then only lasts until the reload.
  }
}

/** Loads the history of the signed-in user and keeps it saved; logging out empties it. */
export function useJobLogPersistence(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    // Jobs finished before the account was known stay in the list too.
    const current = useJobLog.getState().records;
    useJobLog.getState().replaceAll([...current, ...loadJobLog(userId)]);
    saveJobLog(userId, useJobLog.getState().records);
    const unsubscribe = useJobLog.subscribe((state, prev) => {
      if (state.records !== prev.records) saveJobLog(userId, state.records);
    });
    return () => {
      unsubscribe();
      sessionFiles.clear();
      useJobLog.setState({ records: [] });
    };
  }, [userId]);
}
