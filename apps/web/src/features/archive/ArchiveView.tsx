import { SaveToStorageButton } from '@/features/storage/StorageButtons';
import { useMemo, useState } from 'react';
import {
  ArchiveIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  Loader2Icon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ViewIntro } from '@/components/ViewIntro';
import { formatName } from '@/features/convert/format-text';
import { PreviewBody } from '@/features/preview/PreviewDialog';
import { canPreviewInBrowser } from '@/lib/detect-type';
import { useCover } from '@/lib/cover';
import { formatBytes } from '@/lib/format-bytes';
import { createZip, saveBlob, zipFileName } from '@/lib/zip';
import { dayLabel } from './day-label';
import { JobLogView } from './JobLogView';
import { JOB_LOG_DAYS, useJobLog } from './job-log';
import { ARCHIVE_DAYS } from './history-persistence';
import { entryUrl, useHistory, type HistoryEntry } from './history-store';

function Thumbnail({ entry }: { entry: HistoryEntry }) {
  const picture = canPreviewInBrowser(entry.ext) ? entryUrl(entry) : null;
  // Videos and music: a frame or the cover inside the file.
  const cover = useCover(picture ? null : entry.result, entry.ext);
  const url = picture ?? cover;
  return url ? (
    <img src={url} alt="" className="size-full object-cover" />
  ) : (
    <FileIcon className="size-5 text-muted-foreground" aria-hidden="true" />
  );
}

function EntryCard({ entry, onPreview }: { entry: HistoryEntry; onPreview: () => void }) {
  const { t, i18n } = useTranslation();
  const remove = useHistory((s) => s.remove);
  const saved =
    entry.sourceSize > 0 ? Math.round((1 - entry.result.size / entry.sourceSize) * 100) : 0;
  const time = new Date(entry.createdAt).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Card className="flex-row items-center gap-3 p-3" data-testid="archive-entry">
      <button
        type="button"
        onClick={onPreview}
        aria-label={t('preview.openNamed', { name: entry.fileName })}
        title={t('preview.open')}
        className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Thumbnail entry={entry} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={entry.fileName}>
          {entry.fileName}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {formatName(t, entry.ext)} · {formatBytes(entry.result.size, i18n.language)}
          {entry.task === 'compress' &&
            (entry.keptOriginal
              ? ` · ${t('archive.keptOriginal')}`
              : ` · ${t('archive.saved', { percent: saved })}`)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t(entry.task === 'compress' ? 'archive.compressedFrom' : 'archive.convertedFrom', {
            name: entry.sourceName,
            time,
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onPreview}
          aria-label={t('preview.openNamed', { name: entry.fileName })}
        >
          <EyeIcon aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveBlob(entry.result, entry.fileName)}
          aria-label={t('archive.downloadNamed', { name: entry.fileName })}
        >
          <DownloadIcon aria-hidden="true" />
          <span className="max-sm:sr-only">{t('convert.download')}</span>
        </Button>
        <SaveToStorageButton
          size="sm"
          compact
          label={t('storage.save.short')}
          items={[{ blob: entry.result, fileName: entry.fileName }]}
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => remove(entry.id)}
          aria-label={t('archive.removeNamed', { name: entry.fileName })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

type ArchiveTab = 'files' | 'history';

/** The archive page: finished files and the history of every job. */
export function ArchiveView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ArchiveTab>('files');
  const files = useHistory((s) => s.entries.length);
  const jobs = useJobLog((s) => s.records.length);
  return (
    <div className="space-y-6">
      <ViewIntro help="archive">
        {tab === 'files'
          ? t('archive.intro', { days: ARCHIVE_DAYS })
          : t('history.intro', { days: JOB_LOG_DAYS })}
      </ViewIntro>
      <Tabs value={tab} onValueChange={(v) => setTab(v as ArchiveTab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="files">
            {t('archive.tabs.files')}
            {files > 0 && <span className="tabular-nums text-muted-foreground">{files}</span>}
          </TabsTrigger>
          <TabsTrigger value="history">
            {t('archive.tabs.history')}
            {jobs > 0 && <span className="tabular-nums text-muted-foreground">{jobs}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          <ArchiveFiles />
        </TabsContent>
        <TabsContent value="history">
          <JobLogView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Everything converted or compressed in this browser – download any time. */
function ArchiveFiles() {
  const { t, i18n } = useTranslation();
  const entries = useHistory((s) => s.entries);
  const loaded = useHistory((s) => s.loaded);
  const clear = useHistory((s) => s.clear);
  const [preview, setPreview] = useState<HistoryEntry | null>(null);
  const [zipping, setZipping] = useState(false);
  const total = entries.reduce((sum, e) => sum + e.result.size, 0);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const label = dayLabel(entry.createdAt, i18n.language, t);
      map.set(label, [...(map.get(label) ?? []), entry]);
    }
    return [...map.entries()];
  }, [entries, i18n.language, t]);

  const downloadAll = async () => {
    setZipping(true);
    try {
      const zip = await createZip(entries.map((e) => ({ name: e.fileName, blob: e.result })));
      saveBlob(zip, zipFileName());
    } catch (error) {
      console.error('zip failed', error);
      toast.error(t('convert.zipFailed'));
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="space-y-6">
      {!loaded ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('archive.loading')}
        </p>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <ArchiveIcon className="size-6" aria-hidden="true" />
          <p>{t('archive.empty')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t('archive.summary', {
                count: entries.length,
                size: formatBytes(total, i18n.language),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void downloadAll()}
                disabled={zipping}
              >
                {zipping ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                {t('archive.downloadAll')}
              </Button>
              <SaveToStorageButton
                size="sm"
                label={t('storage.save.all')}
                items={entries.map((e) => ({ blob: e.result, fileName: e.fileName }))}
              />
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
                      {t('archive.clearText', { count: entries.length })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('archive.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={clear}>
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
                {list.map((entry) => (
                  <li key={entry.id}>
                    <EntryCard entry={entry} onPreview={() => setPreview(entry)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{preview.fileName}</DialogTitle>
              <DialogDescription>{t('preview.intro')}</DialogDescription>
            </DialogHeader>
            <PreviewBody
              source={{
                key: preview.id,
                blob: preview.result,
                ext: preview.ext,
                name: preview.fileName,
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
