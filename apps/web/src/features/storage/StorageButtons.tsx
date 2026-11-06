import { useState } from 'react';
import { HardDriveDownloadIcon, HardDriveUploadIcon, Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { FolderBrowser } from './FolderBrowser';
import { StoragePreview } from './StoragePreview';
import { SaveToStorageDialog, type SaveItem } from './SaveToStorageDialog';
import { browseTarget, openFromTarget, useTargets } from './storage-api';

/** „Speichern unter …“ – only shown when there is a location to save to. */
export function SaveToStorageButton({
  items,
  onSaved,
  size = 'default',
  label,
  compact = false,
}: {
  items: SaveItem[];
  onSaved?: (() => void) | undefined;
  size?: 'default' | 'sm';
  label?: string;
  /** Text only for screen readers on phones (tight rows like the archive). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const targets = useTargets();
  if (!targets.data?.some((target) => target.usage.asTarget) || items.length === 0) return null;
  const text = label ?? t('storage.save.open');
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        aria-label={
          items.length === 1 ? t('storage.save.openNamed', { name: items[0]?.fileName }) : undefined
        }
      >
        <HardDriveUploadIcon aria-hidden="true" />
        <span className={compact ? 'max-sm:sr-only' : undefined}>{text}</span>
      </Button>
      <SaveToStorageDialog open={open} onOpenChange={setOpen} items={items} onSaved={onSaved} />
    </>
  );
}

/** „Von Speicherort öffnen“ next to the drop zone. */
export function OpenFromStorageButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const targets = useTargets();
  if (!targets.data?.some((target) => target.usage.asSource)) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <HardDriveDownloadIcon aria-hidden="true" />
        {t('storage.open.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-4xl [&>*]:min-w-0"
          onClick={(event) => event.stopPropagation()}
        >
          {open && (
            <OpenBody
              onDone={(files) => {
                setOpen(false);
                if (files.length > 0) onFiles(files);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpenBody({ onDone }: { onDone: (files: File[]) => void }) {
  const { t } = useTranslation();
  const sources = (useTargets().data ?? []).filter((target) => target.usage.asSource);
  const [targetId, setTargetId] = useState<string | undefined>(
    () => (sources.find((s) => s.isDefault) ?? sources[0])?.id,
  );
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  /** The file clicked last – shown in the preview. */
  const [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const openFiles = async () => {
    if (!targetId) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await openFromTarget(targetId, selected));
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network', String(e)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('storage.open.title')}</DialogTitle>
        <DialogDescription>{t('storage.open.intro')}</DialogDescription>
      </DialogHeader>
      {sources.length > 1 && (
        <Select
          value={targetId}
          onValueChange={(id) => {
            setTargetId(id);
            setPath('');
            setSelected([]);
            setFocused(null);
          }}
        >
          <SelectTrigger aria-label={t('storage.open.location')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {targetId && (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <FolderBrowser
            mode="files"
            path={path}
            onPathChange={setPath}
            selected={selected}
            onSelectedChange={setSelected}
            focused={focused}
            onFocusFile={setFocused}
            reloadKey={targetId}
            load={(p) => browseTarget(targetId, p)}
          />
          <StoragePreview targetId={targetId} path={focused} />
        </div>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onDone([])}>
          {t('storage.cancel')}
        </Button>
        <Button
          type="button"
          onClick={() => void openFiles()}
          disabled={selected.length === 0 || busy}
        >
          {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {t('storage.open.confirm', { count: selected.length })}
        </Button>
      </DialogFooter>
    </>
  );
}
