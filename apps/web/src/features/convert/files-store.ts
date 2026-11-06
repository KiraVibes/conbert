import { create } from 'zustand';
import {
  changeOption,
  outputFileName,
  imageAiOptions,
  pickImageAiOptions,
  pickTrimOptions,
  readImageAi,
  trimOptions,
  type CompressLevel,
  type ExecutionMode,
  type ImageAi,
  type MetadataEdits,
  type PurposeChoice,
  type PurposeId,
  type Trim,
} from '@conbert/core';
import { canPreviewInBrowser, detectFileType } from '@/lib/detect-type';
import { forgetUpload } from '@/engines/server-convert';
import { useHistory } from '@/features/archive/history-store';
import { createId } from '@/lib/id';

export type FileStatus = 'detecting' | 'idle' | 'converting' | 'done' | 'error';

export interface ConversionResult {
  blob: Blob;
  url: string;
  ext: string;
  fileName: string;
  /** Compressing made it bigger, so this is the original file. */
  keptOriginal?: boolean;
}

/** What the file is in the list for: the "Umwandeln" or the "Komprimieren" tab. */
export type FileTask = 'convert' | 'compress';

export interface CompressChoice {
  level: CompressLevel;
  /** Desired size in MB (level "target"). */
  targetMb: number | null;
  stripMetadata: boolean;
}

export const DEFAULT_COMPRESS: CompressChoice = {
  level: 'balanced',
  targetMb: null,
  stripMetadata: true,
};

export interface FileError {
  /** Base key of a three-part error text (`<key>.what/.cause/.action`). */
  messageKey: string;
  details?: string;
}

/** How the automatic copy to a storage location went. */
export interface AutoSaveState {
  state: 'saving' | 'saved' | 'skipped' | 'error';
  targetId: string;
  /** Where it ended up, relative to the location's folder. */
  path?: string;
  error?: FileError;
}

export interface FileItem {
  id: string;
  file: File;
  /** Name shown and used for results; starts as the original name, can be renamed. */
  name: string;
  task: FileTask;
  compress: CompressChoice;
  /** Extension we treat the file as (from magic bytes, else the name). */
  ext: string;
  /** The file name claims a different format than the content. */
  extMismatch: boolean;
  nameExt: string | null;
  /** Object URL for the thumbnail, if the browser can show the format. */
  previewUrl: string | null;
  targetExt: string | null;
  mode: ExecutionMode;
  options: Record<string, unknown>;
  status: FileStatus;
  progress: number;
  stage?: string;
  result?: ConversionResult;
  error?: FileError;
  /** Automatic saving to a storage location (setting), if switched on. */
  autoSave?: AutoSaveState;
  /** Metadata changes (expert mode), written into the result after converting. */
  metadata?: MetadataEdits;
  /** Whether writing them worked (the result is kept either way). */
  metadataOutcome?: { state: 'written' | 'error'; error?: FileError };
  /** Last purpose of the assistant this file was checked against (stays when changed by hand). */
  purposeChecked?: PurposeId;
  /** What the assistant did, shown on the card; cleared when the format is changed by hand. */
  purpose?: PurposeNote;
}

export interface PurposeNote {
  id: PurposeId;
  state: 'applied' | 'alreadyFine' | 'notApplicable';
  reasonKey?: string;
}

/** Settings to apply right away, e.g. "again with the same settings" from the history. */
export interface FilePreset {
  targetExt: string;
  options: Record<string, unknown>;
  compress?: CompressChoice;
}

interface FilesState {
  files: FileItem[];
  rename: (id: string, name: string) => void;
  /** Empties everything (after logging out – the next account must not see these files). */
  reset: () => void;
  addFiles: (
    files: File[],
    mode: ExecutionMode,
    task?: FileTask,
    preset?: FilePreset,
  ) => Promise<void>;
  setCompress: (id: string, patch: Partial<CompressChoice>) => void;
  removeFile: (id: string) => void;
  clear: (task?: FileTask) => void;
  update: (id: string, patch: Partial<FileItem>) => void;
  setTarget: (id: string, ext: string | null) => void;
  setMode: (id: string, mode: ExecutionMode) => void;
  setOption: (id: string, key: string, value: unknown) => void;
  /** The part of a video or song to keep (null = all of it). */
  setTrim: (id: string, trim: Trim | null) => void;
  /** AI work on a picture (background, upscaling), on the server. */
  setImageAi: (id: string, ai: Partial<ImageAi>) => void;
  setMetadata: (id: string, edits: MetadataEdits) => void;
  setResult: (id: string, result: ConversionResult) => void;
  /** The assistant's pick for this file; a compress choice moves it to the compress tab. */
  applyPurpose: (id: string, choice: PurposeChoice) => void;
  /** Notes that the purpose leaves this file as it is (already fine / doesn't fit). */
  notePurpose: (id: string, note: PurposeNote) => void;
}

/** Frees object URLs and removes a server copy of the file, if there is one. */
function revoke(item: FileItem): void {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.result) URL.revokeObjectURL(item.result.url);
  forgetUpload(item.file);
}

/** Changing what to produce invalidates an old result. */
function resetOutcome(item: FileItem): Partial<FileItem> {
  if (item.result) URL.revokeObjectURL(item.result.url);
  return {
    status: 'idle',
    progress: 0,
    result: undefined,
    error: undefined,
    stage: undefined,
    metadataOutcome: undefined,
    autoSave: undefined,
  };
}

/** Characters that aren't allowed in file names on Windows, macOS or Linux. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Cleans a user-typed base name; null if nothing usable is left. */
export function cleanBaseName(input: string): string | null {
  const cleaned = input.replace(FORBIDDEN, '_').trim().replace(/^\.+/, '').slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

/** "photo.final.jpg" → { base: "photo.final", suffix: ".jpg" } */
export function splitName(name: string): { base: string; suffix: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0
    ? { base: name.slice(0, dot), suffix: name.slice(dot) }
    : { base: name, suffix: '' };
}

export const useFiles = create<FilesState>()((set, get) => ({
  files: [],

  rename(id, base) {
    const clean = cleanBaseName(base);
    if (!clean) return;
    set((s) => ({
      files: s.files.map((f) => {
        if (f.id !== id) return f;
        const name = clean + splitName(f.name).suffix;
        const result = f.result && { ...f.result, fileName: outputFileName(name, f.result.ext) };
        if (result) useHistory.getState().renameFrom(f.id, result.fileName);
        return { ...f, name, ...(result && { result }) };
      }),
    }));
  },

  reset() {
    get().files.forEach(revoke);
    set({ files: [] });
  },

  async addFiles(files, mode, task = 'convert', preset) {
    const items: FileItem[] = files.map((file) => ({
      id: createId(),
      file,
      name: file.name,
      task,
      compress: preset?.compress ?? DEFAULT_COMPRESS,
      ext: '',
      extMismatch: false,
      nameExt: null,
      previewUrl: null,
      targetExt: null,
      mode,
      options: {},
      status: 'detecting',
      progress: 0,
    }));
    set((s) => ({ files: [...s.files, ...items] }));

    await Promise.all(
      items.map(async (item) => {
        const type = await detectFileType(item.file);
        // The file may have been removed while we were detecting.
        if (!get().files.some((f) => f.id === item.id)) return;
        get().update(item.id, {
          ext: type.ext,
          extMismatch: type.mismatch,
          nameExt: type.nameExt,
          previewUrl: canPreviewInBrowser(type.ext) ? URL.createObjectURL(item.file) : null,
          status: 'idle',
          ...(preset && { targetExt: preset.targetExt, options: { ...preset.options } }),
        });
      }),
    );
  },

  removeFile(id) {
    const item = get().files.find((f) => f.id === id);
    if (item) revoke(item);
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  /** Removes every file of one tab (Umwandeln or Komprimieren). */
  clear(task = 'convert') {
    const gone = (f: FileItem) => f.task === task;
    get().files.filter(gone).forEach(revoke);
    set((s) => ({ files: s.files.filter((f) => !gone(f)) }));
  },

  update(id, patch) {
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  },

  setTarget(id, ext) {
    set((s) => ({
      files: s.files.map((f) =>
        f.id === id && f.targetExt !== ext
          ? // The cut part belongs to the file, not to the format.
            {
              ...f,
              ...resetOutcome(f),
              targetExt: ext,
              options: { ...pickTrimOptions(f.options), ...pickImageAiOptions(f.options) },
              purpose: undefined,
            }
          : f,
      ),
    }));
  },

  setCompress(id, patch) {
    set((s) => ({
      files: s.files.map((f) =>
        f.id === id ? { ...f, ...resetOutcome(f), compress: { ...f.compress, ...patch } } : f,
      ),
    }));
  },

  setMode(id, mode) {
    set((s) => ({
      files: s.files.map((f) => (f.id === id ? { ...f, ...resetOutcome(f), mode } : f)),
    }));
  },

  setMetadata(id, edits) {
    set((s) => ({
      files: s.files.map((f) => (f.id === id ? { ...f, ...resetOutcome(f), metadata: edits } : f)),
    }));
  },

  setOption(id, key, value) {
    set((s) => ({
      files: s.files.map((f) =>
        // changeOption also applies linked options (lossless → quality 100).
        f.id === id
          ? { ...f, ...resetOutcome(f), options: changeOption(f.options, key, value) }
          : f,
      ),
    }));
  },

  setTrim(id, trim) {
    set((s) => ({
      files: s.files.map((f) => {
        if (f.id !== id) return f;
        const options = Object.fromEntries(
          Object.entries({ ...f.options, ...trimOptions(trim) }).filter(([, v]) => v !== undefined),
        );
        return { ...f, ...resetOutcome(f), options };
      }),
    }));
  },

  setImageAi(id, ai) {
    set((s) => ({
      files: s.files.map((f) => {
        if (f.id !== id) return f;
        const current = readImageAi(f.options) ?? { removeBackground: false, upscale: 1 };
        const options = Object.fromEntries(
          Object.entries({ ...f.options, ...imageAiOptions({ ...current, ...ai }) }).filter(
            ([, v]) => v !== undefined,
          ),
        );
        return { ...f, ...resetOutcome(f), options };
      }),
    }));
  },

  applyPurpose(id, choice) {
    set((s) => ({
      files: s.files.map((f) =>
        f.id === id
          ? {
              ...f,
              ...resetOutcome(f),
              targetExt: choice.targetExt,
              options: {
                ...pickTrimOptions(f.options),
                ...pickImageAiOptions(f.options),
                ...choice.options,
              },
              ...(choice.compress && {
                task: 'compress' as const,
                compress: { ...f.compress, ...choice.compress },
              }),
              purposeChecked: choice.purpose,
              purpose: { id: choice.purpose, state: 'applied', reasonKey: choice.reasonKey },
            }
          : f,
      ),
    }));
  },

  notePurpose(id, note) {
    set((s) => ({
      files: s.files.map((f) =>
        f.id === id ? { ...f, purposeChecked: note.id, purpose: note } : f,
      ),
    }));
  },

  setResult(id, result) {
    const old = get().files.find((f) => f.id === id)?.result;
    if (old) URL.revokeObjectURL(old.url);
    get().update(id, {
      result,
      status: 'done',
      progress: 100,
      stage: 'done',
      error: undefined,
    });
  },
}));
