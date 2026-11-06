import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckIcon, PencilIcon, StarIcon, XIcon } from 'lucide-react';
import type { PatchTargetRequest, StorageTargetDto } from '@conbert/schemas';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError } from '@/lib/api';
import { TARGETS_KEY, patchTarget } from './storage-api';

/** Saves a quick change and refreshes everything that shows locations. */
function usePatch(target: StorageTargetDto) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (body: PatchTargetRequest, done?: string) => {
    setBusy(true);
    try {
      await patchTarget(target.id, body);
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY });
      // The swipe game follows the default location.
      await queryClient.invalidateQueries({ queryKey: ['media-status'] });
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(
        t(`${error instanceof ApiRequestError ? error.messageKey : 'errors.network'}.what`),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** The location's name – a click on the pencil makes it editable in place. */
export function TargetName({ target }: { target: StorageTargetDto }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(target.name);
  const { run, busy } = usePatch(target);
  const clean = name.trim();

  const save = async () => {
    if (!clean || clean === target.name) {
      setEditing(false);
      return;
    }
    if (await run({ name: clean }, t('storage.quick.renamed', { name: clean }))) {
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <p className="flex items-center gap-1.5 font-medium">
        <span className="truncate">{target.name}</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t('storage.quick.rename', { name: target.name })}
          title={t('storage.quick.rename', { name: target.name })}
          onClick={() => {
            setName(target.name);
            setEditing(true);
          }}
        >
          <PencilIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </p>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        autoFocus
        className="h-8"
        value={name}
        maxLength={100}
        aria-label={t('storage.wizard.name')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={busy || !clean}
        aria-label={t('storage.quick.save')}
        title={t('storage.quick.save')}
      >
        <CheckIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={t('storage.cancel')}
        title={t('storage.cancel')}
        onClick={() => setEditing(false)}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </form>
  );
}

/** "Save here" / "Open from here" and "default" – switched right in the list. */
export function TargetUse({ target }: { target: StorageTargetDto }) {
  const { t } = useTranslation();
  const { run, busy } = usePatch(target);
  const { asTarget, asSource } = target.usage;

  const toggle = (key: 'asTarget' | 'asSource', on: boolean) => {
    const usage = { asTarget, asSource, [key]: on };
    if (!usage.asTarget && !usage.asSource) {
      toast.error(t('storage.quick.oneUse'));
      return;
    }
    void run({ usage });
  };

  const row = (key: 'asTarget' | 'asSource', checked: boolean) => (
    <div className="flex items-center gap-2">
      <Switch
        id={`use-${key}-${target.id}`}
        checked={checked}
        disabled={busy}
        onCheckedChange={(on) => toggle(key, on)}
      />
      <label htmlFor={`use-${key}-${target.id}`} className="text-sm">
        {t(`storage.wizard.${key}`)}
      </label>
      <HelpTip helpKey={`storage.wizard.${key}Help`} labelKey={`storage.wizard.${key}`} />
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {row('asTarget', asTarget)}
      {row('asSource', asSource)}
      {!target.isDefault && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run({ isDefault: true }, t('storage.quick.nowDefault', { name: target.name }))
          }
        >
          <StarIcon aria-hidden="true" />
          {t('storage.quick.makeDefault')}
        </Button>
      )}
    </div>
  );
}
