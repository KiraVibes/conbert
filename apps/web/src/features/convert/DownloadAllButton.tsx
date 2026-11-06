import { useState } from 'react';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/HelpTip';
import { SaveToStorageButton } from '@/features/storage/StorageButtons';
import { createZip, saveBlob, zipFileName } from '@/lib/zip';
import { useFiles, type FileTask } from './files-store';
import { useRemoveAfterDownload } from './use-remove-after-download';

/**
 * Downloads every finished result of the list at once – one file directly,
 * several as ZIP. Afterwards the cards leave the list (the archive keeps them).
 */
export function DownloadAllButton({ task = 'convert' }: { task?: FileTask }) {
  const { t } = useTranslation();
  const files = useFiles((s) => s.files);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const removeAfterDownload = useRemoveAfterDownload();
  const done = files.filter((f) => f.task === task && f.status === 'done' && f.result);
  const results = done.flatMap((f) => (f.result ? [f.result] : []));
  if (results.length === 0) return null;

  const download = async () => {
    const [only] = results;
    if (results.length === 1 && only) {
      saveBlob(only.blob, only.fileName);
      removeAfterDownload(done.map((f) => f.id));
      return;
    }
    setProgress({ done: 0, total: results.length });
    try {
      const zip = await createZip(
        results.map((r) => ({ name: r.fileName, blob: r.blob })),
        (done, total) => setProgress({ done, total }),
      );
      saveBlob(zip, zipFileName());
      removeAfterDownload(done.map((f) => f.id));
    } catch (error) {
      console.error('zip failed', error);
      toast.error(t('convert.zipFailed'));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void download()}
        disabled={progress !== null}
      >
        {progress ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
        {progress
          ? t('convert.zipping', { done: progress.done, total: progress.total })
          : t('convert.downloadAll', { count: results.length })}
      </Button>
      <HelpTip helpKey="convert.downloadAllHelp" labelKey="convert.downloadAllLabel" />
      {results.length > 1 && (
        <SaveToStorageButton
          size="sm"
          label={t('storage.save.all')}
          items={results.map((r) => ({ blob: r.blob, fileName: r.fileName }))}
          onSaved={() => removeAfterDownload(done.map((f) => f.id))}
        />
      )}
    </div>
  );
}
