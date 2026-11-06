import { useState } from 'react';
import { InfoIcon, Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ExportResult } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { FolderBrowser } from './FolderBrowser';
import { browseTarget, makeFolder, saveToTargets, useTargets } from './storage-api';
import { STORAGE_ICONS, markPrivacyHintSeen, privacyHintSeen } from './storage-ui';

export interface SaveItem {
  blob: Blob;
  fileName: string;
}

interface SaveToStorageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SaveItem[];
  /** Called after every file was saved somewhere. */
  onSaved?: () => void;
}

/** „Speichern unter …“: puts results on one or more storage locations. */
export function SaveToStorageDialog({
  open,
  onOpenChange,
  items,
  onSaved,
}: SaveToStorageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-xl grid-cols-[minmax(0,1fr)] [&>*]:min-w-0">
        {open && (
          <SaveBody
            items={items}
            onDone={(allSaved) => {
              onOpenChange(false);
              if (allSaved) onSaved?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveBody({ items, onDone }: { items: SaveItem[]; onDone: (allSaved: boolean) => void }) {
  const { t } = useTranslation();
  const targets = (useTargets().data ?? []).filter((target) => target.usage.asTarget);
  // Preselect the default location (or the only one). The list is already
  // loaded – the button that opens this dialog only shows up with it.
  const [selected, setSelected] = useState<string[]>(() => {
    const preferred =
      targets.find((target) => target.isDefault) ?? (targets.length === 1 ? targets[0] : undefined);
    return preferred ? [preferred.id] : [];
  });
  const [chooseFolder, setChooseFolder] = useState(false);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<{ name: string; result: ExportResult }[]>([]);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [showHint] = useState(() => !privacyHintSeen());

  const single =
    selected.length === 1 ? targets.find((target) => target.id === selected[0]) : undefined;
  const nameOf = (id: string) => targets.find((target) => target.id === id)?.name ?? id;

  const save = async () => {
    setBusy({ done: 0, total: items.length });
    setFailed([]);
    setError(null);
    const problems: { name: string; result: ExportResult }[] = [];
    try {
      for (const [index, item] of items.entries()) {
        const results = await saveToTargets(
          item.blob,
          item.fileName,
          selected,
          chooseFolder && single ? folder : undefined,
        );
        for (const result of results) {
          if (result.status === 'error') problems.push({ name: item.fileName, result });
        }
        setBusy({ done: index + 1, total: items.length });
      }
      markPrivacyHintSeen();
      if (problems.length > 0) {
        setFailed(problems);
        return;
      }
      toast.success(
        t('storage.save.done', {
          count: items.length,
          targets: selected.map(nameOf).join(', '),
        }),
      );
      onDone(true);
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network', String(e)),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('storage.save.title')}</DialogTitle>
        <DialogDescription>
          {items.length === 1
            ? t('storage.save.introOne', { name: items[0]?.fileName ?? '' })
            : t('storage.save.introMany', { count: items.length })}
        </DialogDescription>
      </DialogHeader>

      {showHint && (
        <p className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {t('storage.save.privacyHint')}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t('storage.save.where')}</legend>
        {targets.map((target) => {
          const Icon = STORAGE_ICONS[target.type];
          const checked = selected.includes(target.id);
          return (
            <label
              key={target.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 hover:bg-muted has-[:checked]:border-primary"
            >
              <input
                type="checkbox"
                className="size-4"
                checked={checked}
                onChange={() =>
                  setSelected((s) =>
                    checked ? s.filter((id) => id !== target.id) : [...s, target.id],
                  )
                }
              />
              <Icon className="size-4 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{target.name}</span>
              {target.subfolderPattern && (
                <code className="hidden shrink-0 rounded bg-muted px-1 text-xs sm:block">
                  {target.subfolderPattern}
                </code>
              )}
            </label>
          );
        })}
      </fieldset>

      {single && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="save-choose-folder">{t('storage.save.chooseFolder')}</Label>
            <Switch
              id="save-choose-folder"
              checked={chooseFolder}
              onCheckedChange={setChooseFolder}
            />
          </div>
          {chooseFolder && (
            <FolderBrowser
              mode="folder"
              path={folder}
              onPathChange={setFolder}
              reloadKey={single.id}
              load={(p) => browseTarget(single.id, p)}
              onMakeFolder={(p, name) => makeFolder(single.id, p, name)}
            />
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="space-y-2">
          {failed.map(({ name, result }, i) => (
            <ErrorMessage
              key={i}
              messageKey={result.error?.messageKey ?? 'errors.storageFailed'}
              details={`${name} → ${nameOf(result.targetId)}${result.error?.details ? `\n${result.error.details}` : ''}`}
            />
          ))}
        </div>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          {t('storage.cancel')}
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={selected.length === 0 || busy !== null}
        >
          {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {busy && items.length > 1
            ? t('storage.save.progress', { done: busy.done, total: busy.total })
            : t('storage.save.button')}
        </Button>
      </DialogFooter>
    </>
  );
}
