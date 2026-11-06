import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  Loader2Icon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { StorageTargetDto } from '@conbert/schemas';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError, apiPost } from '@/lib/api';
import { TARGETS_KEY, deleteTarget, useTargets } from './storage-api';
import { STORAGE_ICONS } from './storage-ui';
import { TargetName, TargetUse } from './QuickEdit';
import { TargetWizard } from './TargetWizard';
import { SettingRow } from '@/features/settings/SettingRow';
import { useSettings } from '@/features/settings/settings-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Settings → „Speicherorte“: NAS, SFTP, Nextcloud, S3 … to save to and open from. */
export function StorageCard() {
  const { t } = useTranslation();
  const targets = useTargets();
  const [wizard, setWizard] = useState<{ open: boolean; existing?: StorageTargetDto }>({
    open: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.card.title')}</CardTitle>
        <CardDescription>{t('storage.card.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {targets.error && (
          <ErrorMessage
            messageKey={
              targets.error instanceof ApiRequestError ? targets.error.messageKey : 'errors.network'
            }
          />
        )}
        {targets.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('storage.card.empty')}</p>
        )}
        <AutoSaveSetting />
        <ul className="space-y-2">
          {targets.data?.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              onEdit={() => setWizard({ open: true, existing: target })}
            />
          ))}
        </ul>
        <Button onClick={() => setWizard({ open: true })}>
          <PlusIcon aria-hidden="true" />
          {t('storage.card.add')}
        </Button>
      </CardContent>
      <TargetWizard
        open={wizard.open}
        existing={wizard.existing}
        onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
      />
    </Card>
  );
}

function TargetRow({ target, onEdit }: { target: StorageTargetDto; onEdit: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [test, setTest] = useState<'idle' | 'running' | 'ok' | ApiRequestError>('idle');
  const Icon = STORAGE_ICONS[target.type];

  const runTest = async () => {
    setTest('running');
    try {
      await apiPost(`/api/targets/${target.id}/test`, {});
      setTest('ok');
    } catch (e) {
      setTest(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    }
  };

  const remove = async () => {
    await deleteTarget(target.id);
    // Automatic saving pointed here: switch it off instead of failing later.
    const settings = useSettings.getState();
    if (settings.autoSaveTargetId === target.id) settings.setAutoSaveTargetId(null);
    await queryClient.invalidateQueries({ queryKey: TARGETS_KEY });
    toast.success(t('storage.card.deleted', { name: target.name }));
  };

  return (
    <li className="space-y-2 rounded-lg border p-3" data-testid="storage-target">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TargetName target={target} />
            {target.isDefault && (
              <StarIcon
                className="size-4 shrink-0 fill-amber-400 text-amber-400"
                aria-label={t('storage.card.isDefault')}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`storage.types.${target.type}.name`)}
            {target.basePath && ` · /${target.basePath.replace(/^\/+/, '')}`}
          </p>
        </div>
      </div>
      <TargetUse target={target} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runTest()}
          disabled={test === 'running'}
        >
          {test === 'running' ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <PlugZapIcon aria-hidden="true" />
          )}
          {t('storage.wizard.test')}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <PencilIcon aria-hidden="true" />
          {t('storage.card.edit')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Trash2Icon aria-hidden="true" />
              {t('storage.card.delete')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('storage.card.deleteTitle', { name: target.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('storage.card.deleteText')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('storage.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>
                {t('storage.card.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {test === 'ok' && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"
        >
          <CheckCircle2Icon className="size-4" aria-hidden="true" />
          {t('storage.wizard.testOk')}
        </p>
      )}
      {test instanceof ApiRequestError && (
        <ErrorMessage messageKey={test.messageKey} details={test.details} />
      )}
    </li>
  );
}

/** Setting: every finished result is also saved to one location. */
function AutoSaveSetting() {
  const { t } = useTranslation();
  const targets = (useTargets().data ?? []).filter((target) => target.usage.asTarget);
  const autoSaveTargetId = useSettings((s) => s.autoSaveTargetId);
  const setAutoSaveTargetId = useSettings((s) => s.setAutoSaveTargetId);
  if (targets.length === 0) return null;
  const current = targets.some((target) => target.id === autoSaveTargetId)
    ? autoSaveTargetId
    : null;
  return (
    <div className="rounded-lg border px-3">
      <SettingRow
        id="setting-auto-save"
        label={t('storage.autoSave.label')}
        labelKey="storage.autoSave.label"
        helpKey="storage.autoSave.help"
      >
        <Select
          value={current ?? 'off'}
          onValueChange={(v) => setAutoSaveTargetId(v === 'off' ? null : v)}
        >
          <SelectTrigger id="setting-auto-save" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t('storage.autoSave.off')}</SelectItem>
            {targets.map((target) => (
              <SelectItem key={target.id} value={target.id}>
                {target.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  );
}
