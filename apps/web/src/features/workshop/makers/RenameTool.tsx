import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderDownIcon, Loader2Icon } from 'lucide-react';
import { RENAME_TOKENS, exifBasics, packZip, renameFiles, type RenameSource } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/features/convert/Dropzone';
import { cn } from '@/lib/utils';
import { HowItWorks } from '../SingleFile';
import { saveBlob } from '../save-blob';

interface Item extends RenameSource {
  file: File;
  fromExif: boolean;
}

async function itemOf(file: File): Promise<Item> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const exif = exifBasics(head);
  return {
    file,
    name: file.name,
    date: exif.date ?? new Date(file.lastModified),
    camera: exif.camera,
    fromExif: exif.date !== null,
  };
}

/** Stapel-Umbenennen – many files at once by a pattern (with EXIF date and camera). */
export function RenameTool() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Item[]>([]);
  const [pattern, setPattern] = useState('{datum}_{nr}');
  const [start, setStart] = useState(1);
  const [order, setOrder] = useState<'name' | 'date'>('date');
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true });
    return [...items].sort((a, b) =>
      order === 'date'
        ? a.date.getTime() - b.date.getTime() || collator.compare(a.name, b.name)
        : collator.compare(a.name, b.name),
    );
  }, [items, order]);
  const names = useMemo(() => renameFiles(sorted, pattern, { start }), [sorted, pattern, start]);

  async function add(files: File[]) {
    setBusy(true);
    const more = await Promise.all(files.map(itemOf));
    setItems((old) => [...old, ...more]);
    setBusy(false);
  }

  async function download() {
    setBusy(true);
    try {
      const files = await Promise.all(
        sorted.map(async (it, i) => ({
          name: names[i] ?? it.name,
          data: new Uint8Array(await it.file.arrayBuffer()),
        })),
      );
      saveBlob(
        new Blob([(await packZip(files)) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
        'umbenannt.zip',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="rename" />
      <Dropzone compact onFiles={(files) => void add(files)} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="rename-pattern">{t('workshop.rename.pattern')}</Label>
          <Input
            id="rename-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rename-start">{t('workshop.rename.start')}</Label>
          <Input
            id="rename-start"
            type="number"
            min={0}
            value={start}
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
            className="w-28"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label={t('workshop.rename.tokens')}>
        {RENAME_TOKENS.map((tok) => (
          <button
            key={tok}
            type="button"
            title={t(`workshop.rename.token.${tok}`)}
            onClick={() => setPattern((p) => `${p}{${tok}}`)}
            className="rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted"
          >
            {`{${tok}}`}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('workshop.rename.tokensHint')}</p>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={t('workshop.rename.order')}
      >
        {(['date', 'name'] as const).map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={order === o}
            onClick={() => setOrder(o)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              order === o ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {t(`workshop.rename.orders.${o}`)}
          </button>
        ))}
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {sorted.length > 0 && (
        <div className="space-y-3">
          <table className="w-full text-sm" data-testid="rename-table">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-normal">{t('workshop.rename.before')}</th>
                <th className="font-normal">{t('workshop.rename.after')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 300).map((it, i) => (
                <tr key={`${it.name}-${i}`} className="border-t">
                  <td className="truncate py-1 pr-2">{it.name}</td>
                  <td className="truncate py-1 font-medium">
                    {names[i]}
                    {!it.fromExif && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {t('workshop.rename.fileDate')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void download()} disabled={busy}>
              <FolderDownIcon aria-hidden="true" />
              {t('workshop.rename.download', { count: sorted.length })}
            </Button>
            <Button variant="ghost" onClick={() => setItems([])}>
              {t('workshop.rename.clear')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('workshop.rename.zipHint')}</p>
        </div>
      )}
    </div>
  );
}
