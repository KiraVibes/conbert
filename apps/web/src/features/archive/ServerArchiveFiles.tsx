import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CloudIcon,
  DownloadIcon,
  FileIcon,
  ListPlusIcon,
  Loader2Icon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ARCHIVE_ZIP_MAX_BYTES, type ArchivedFile } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatName } from '@/features/convert/format-text';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { dayLabel } from './day-label';
import {
  SERVER_ARCHIVE_KEY,
  archiveZipUrl,
  clearServerArchive,
  deleteArchived,
  keepTimeText,
  useServerArchive,
} from './server-archive-api';

/** Loads archived files into the conversion list; the server keeps its copy. */
async function loadIntoBrowser(files: readonly ArchivedFile[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const response = await fetch(`/api/files/${f.id}/content`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiRequestError(response.status, 'errors.resultGone');
      const blob = await response.blob();
      return new File([blob], f.name, { type: blob.type });
    }),
  );
}

function ArchivedCard({
  file,
  onToList,
  onRemove,
}: {
  file: ArchivedFile;
  onToList: () => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation();
  const goes = new Date(file.expiresAt).toLocaleString(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Card className="flex-row items-center gap-3 p-3" data-testid="server-archive-entry">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {file.thumbnail ? (
          <img
            src={`/api/archive/files/${file.id}/thumb`}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <FileIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {formatName(t, file.ext)} · {formatBytes(file.size, i18n.language)}
          {file.source && ` · ${file.source}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('archive.server.goes', { date: goes })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" asChild>
          <a
            href={`/api/files/${file.id}/content`}
            download={file.name}
            aria-label={t('archive.downloadNamed', { name: file.name })}
          >
            <DownloadIcon aria-hidden="true" />
            <span className="max-sm:sr-only">{t('convert.download')}</span>
          </a>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onToList}
          aria-label={t('archive.server.toListNamed', { name: file.name })}
          title={t('archive.server.toList')}
        >
          <ListPlusIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={t('archive.server.removeNamed', { name: file.name })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

/** Downloads kept on the server (no storage location chosen) until they expire. */
export function ServerArchiveFiles() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const archive = useServerArchive();
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);
  const [busy, setBusy] = useState(false);
  const files = useMemo(() => archive.data?.files ?? [], [archive.data]);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  const groups = useMemo(() => {
    const map = new Map<string, ArchivedFile[]>();
    for (const file of files) {
      const label = dayLabel(Date.parse(file.createdAt), i18n.language, t);
      map.set(label, [...(map.get(label) ?? []), file]);
    }
    return [...map.entries()];
  }, [files, i18n.language, t]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SERVER_ARCHIVE_KEY });
  const failed = (e: unknown) =>
    toast.error(t(`${e instanceof ApiRequestError ? e.messageKey : 'errors.network'}.what`));

  const toList = async (chosen: readonly ArchivedFile[]) => {
    setBusy(true);
    try {
      await addFiles(await loadIntoBrowser(chosen), defaultMode, 'convert');
      toast.success(t('downloader.added', { count: chosen.length }));
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (file: ArchivedFile) => {
    try {
      await deleteArchived(file.id);
    } catch (e) {
      failed(e);
    }
    await refresh();
  };
  const clear = async () => {
    try {
      await clearServerArchive();
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  if (archive.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        {t('archive.loading')}
      </p>
    );
  }
  if (archive.isError) {
    const error = archive.error instanceof ApiRequestError ? archive.error : null;
    return (
      <ErrorMessage messageKey={error?.messageKey ?? 'errors.network'} details={error?.details} />
    );
  }
  const keep = keepTimeText(t, archive.data.keepHours);
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <CloudIcon className="size-6" aria-hidden="true" />
        <p>{t('archive.server.empty', { time: keep })}</p>
      </div>
    );
  }
  const tooBig = total > ARCHIVE_ZIP_MAX_BYTES;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t('archive.summary', { count: files.length, size: formatBytes(total, i18n.language) })}
        </p>
        <div className="flex flex-wrap gap-2">
          {tooBig ? (
            <Button size="sm" variant="outline" disabled title={t('errors.archiveZipTooBig.what')}>
              <DownloadIcon aria-hidden="true" />
              {t('archive.downloadAll')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <a href={archiveZipUrl()} download="conbert-archive.zip">
                <DownloadIcon aria-hidden="true" />
                {t('archive.downloadAll')}
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void toList(files)}>
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <ListPlusIcon aria-hidden="true" />
            )}
            {t('archive.server.allToList')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Trash2Icon aria-hidden="true" />
                {t('archive.clear')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('archive.clearTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('archive.server.clearText', { count: files.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('archive.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void clear()}>
                  {t('archive.clearConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {groups.map(([label, list]) => (
        <section key={label} className="space-y-2" aria-label={label}>
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
          <ul className="space-y-2">
            {list.map((file) => (
              <li key={file.id}>
                <ArchivedCard
                  file={file}
                  onToList={() => void toList([file])}
                  onRemove={() => void remove(file)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
