import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  Loader2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BrowseResponse } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';

interface FolderBrowserProps {
  /** Lists one folder (relative to the location's base folder). */
  load: (path: string) => Promise<BrowseResponse>;
  /** 'folder': pick the current folder. 'files': tick files to open. */
  mode: 'folder' | 'files';
  path: string;
  onPathChange: (path: string) => void;
  selected?: string[];
  onSelectedChange?: (paths: string[]) => void;
  /** Offer "New folder" (only where saving is allowed). */
  onMakeFolder?: (path: string, name: string) => Promise<unknown>;
  /** Changes reload the listing (e.g. other connection settings). */
  reloadKey?: string;
  /** The file clicked last (e.g. for a preview), and who wants to know. */
  focused?: string | null;
  onFocusFile?: (path: string) => void;
}

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Click through the folders of a storage location – no typing of paths. */
export function FolderBrowser({
  load,
  mode,
  path,
  onPathChange,
  selected = [],
  onSelectedChange,
  onMakeFolder,
  reloadKey,
  focused,
  onFocusFile,
}: FolderBrowserProps) {
  const { t, i18n } = useTranslation();
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [mkdirError, setMkdirError] = useState<ApiRequestError | null>(null);
  // Per browser instance: a wizard's unsaved location must never share a cache with another.
  const instance = useId();
  const query = useQuery({
    queryKey: ['storage-browse', instance, reloadKey ?? '', path],
    queryFn: () => load(path),
    gcTime: 0,
    retry: false,
  });
  const listing = query.data ?? null;
  const loading = query.isFetching;
  const error =
    mkdirError ??
    (query.error
      ? query.error instanceof ApiRequestError
        ? query.error
        : new ApiRequestError(0, 'errors.network', String(query.error))
      : null);

  const parts = path ? path.split('/') : [];
  const files = (listing?.entries ?? []).filter((e) => !e.isDir).map((e) => join(path, e.name));
  const allSelected = files.length > 0 && files.every((file) => selected.includes(file));
  const selectAll = () =>
    onSelectedChange?.(
      allSelected
        ? selected.filter((p) => !files.includes(p))
        : [...selected, ...files.filter((file) => !selected.includes(file))],
    );
  const toggle = (file: string) =>
    onSelectedChange?.(
      selected.includes(file) ? selected.filter((p) => p !== file) : [...selected, file],
    );

  const createFolder = async () => {
    const name = newFolder?.trim();
    if (!name || !onMakeFolder) return;
    try {
      setMkdirError(null);
      await onMakeFolder(path, name);
      setNewFolder(null);
      onPathChange(join(path, name));
    } catch (e) {
      if (e instanceof ApiRequestError) setMkdirError(e);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-2" data-testid="folder-browser">
      <nav
        aria-label={t('storage.browser.breadcrumbs')}
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => onPathChange('')}
        >
          <HomeIcon aria-hidden="true" />
          {t('storage.browser.top')}
        </Button>
        {parts.map((part, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1">
            <ChevronRightIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-48 min-w-0 px-2"
              title={part}
              onClick={() => onPathChange(parts.slice(0, i + 1).join('/'))}
            >
              <span className="truncate">{part}</span>
            </Button>
          </span>
        ))}
        {loading && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </nav>

      {error ? (
        <ErrorMessage messageKey={error.messageKey} details={error.details} />
      ) : (
        <>
          {mode === 'files' && files.length > 1 && (
            <label className="flex cursor-pointer items-center gap-2 px-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={allSelected}
                onChange={selectAll}
              />
              {t('storage.browser.selectAll', { count: files.length })}
            </label>
          )}
          <ul
            className="max-h-72 min-h-24 overflow-x-hidden overflow-y-auto rounded-md border p-1 text-sm"
            aria-label={t('storage.browser.list')}
          >
            {listing?.entries.length === 0 && (
              <li className="p-3 text-muted-foreground">{t('storage.browser.empty')}</li>
            )}
            {listing?.entries.map((entry) => {
              const full = join(path, entry.name);
              if (entry.isDir) {
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2"
                      onClick={() => onPathChange(full)}
                    >
                      <FolderIcon className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                      <span className="min-w-0 truncate" title={entry.name}>
                        {entry.name}
                      </span>
                    </button>
                  </li>
                );
              }
              const checked = selected.includes(full);
              return (
                <li key={entry.name}>
                  <label
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1.5',
                      mode === 'files' ? 'cursor-pointer hover:bg-muted' : 'text-muted-foreground',
                      checked && 'bg-primary/10',
                      focused === full && 'ring-1 ring-primary',
                    )}
                    onClick={() => mode === 'files' && onFocusFile?.(full)}
                  >
                    {mode === 'files' ? (
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={checked}
                        onChange={() => toggle(full)}
                      />
                    ) : (
                      <FileIcon className="size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 truncate" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatBytes(entry.size, i18n.language)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {listing?.truncated && (
        <p className="text-xs text-muted-foreground">{t('storage.browser.truncated')}</p>
      )}

      {onMakeFolder &&
        (newFolder === null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setNewFolder('')}>
            <FolderPlusIcon aria-hidden="true" />
            {t('storage.browser.newFolder')}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Input
              autoFocus
              aria-label={t('storage.browser.newFolderName')}
              placeholder={t('storage.browser.newFolderName')}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void createFolder();
                }
                if (e.key === 'Escape') setNewFolder(null);
              }}
            />
            <Button type="button" size="sm" onClick={() => void createFolder()}>
              {t('storage.browser.create')}
            </Button>
          </div>
        ))}
    </div>
  );
}
