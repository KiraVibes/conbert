import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, ChevronLeftIcon, Loader2Icon, PlugZapIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CONFLICT_POLICIES,
  STORAGE_FIELDS,
  STORAGE_TYPES,
  joinStoragePath,
  type StorageField,
  type SupportedStorageType,
} from '@conbert/core';
import type { SaveTargetRequest, StorageTargetDto } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import { FolderBrowser } from './FolderBrowser';
import {
  TARGETS_KEY,
  makeFolderDraft,
  probeTarget,
  saveTarget,
  useStorageRoots,
} from './storage-api';
import { STORAGE_ICONS } from './storage-ui';

type Step = 'type' | 'connection' | 'folder';
type Values = Record<string, string | number | boolean>;

interface TargetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this location instead of creating a new one. */
  existing?: StorageTargetDto | undefined;
}

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network', String(e));

/**
 * „Neuen Speicherort hinzufügen“ step by step: pick the kind, fill in the
 * connection (with a test button), then pick the folder and a name.
 */
export function TargetWizard({ open, onOpenChange, existing }: TargetWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl grid-cols-[minmax(0,1fr)] [&>*]:min-w-0">
        {open && <WizardBody existing={existing} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function WizardBody({
  existing,
  onDone,
}: {
  existing?: StorageTargetDto | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const expert = useSettings((s) => s.expertMode);
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(existing ? 'connection' : 'type');
  const [type, setType] = useState<SupportedStorageType>(
    (existing?.type as SupportedStorageType | undefined) ?? 'smb',
  );
  const [values, setValues] = useState<Values>(existing?.settings ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  /** Secret fields the user wants to replace (otherwise the stored value stays). */
  const [changing, setChanging] = useState<string[]>([]);
  const [startFolder, setStartFolder] = useState('');
  const [folder, setFolder] = useState(existing?.basePath ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [asTarget, setAsTarget] = useState(existing?.usage.asTarget ?? true);
  const [asSource, setAsSource] = useState(existing?.usage.asSource ?? true);
  const [conflictPolicy, setConflictPolicy] = useState(existing?.conflictPolicy ?? 'rename');
  const [pattern, setPattern] = useState(existing?.subfolderPattern ?? '');
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [test, setTest] = useState<'idle' | 'running' | 'ok' | ApiRequestError>('idle');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiRequestError | null>(null);
  const roots = useStorageRoots(type === 'local');

  const fields = STORAGE_FIELDS[type].filter((f) => expert || !f.advanced);
  const stored = existing?.storedSecrets ?? [];

  const draft = (basePath: string): SaveTargetRequest => ({
    name: name.trim() || t(`storage.types.${type}.name`),
    type,
    basePath,
    usage: { asTarget, asSource },
    conflictPolicy,
    subfolderPattern: pattern.trim(),
    isDefault,
    settings: values,
    // Only secrets that were typed (new location or "Ändern" clicked).
    secrets: Object.fromEntries(
      Object.entries(secrets).filter(
        ([key]) => !existing || !stored.includes(key) || changing.includes(key),
      ),
    ),
  });

  const missing = STORAGE_FIELDS[type].some((f) => {
    if (!f.required) return false;
    if (f.secret) return !secrets[f.key] && !(stored.includes(f.key) && !changing.includes(f.key));
    const v = values[f.key];
    return v === undefined || v === '';
  });

  const runTest = async () => {
    setTest('running');
    try {
      await probeTarget(draft(startFolder), '', existing?.id);
      setTest('ok');
    } catch (e) {
      setTest(asError(e));
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const basePath = joinStoragePath(startFolder.replace(/\/+$/, ''), folder);
      const saved = await saveTarget(draft(basePath), existing?.id);
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY });
      toast.success(t('storage.wizard.saved', { name: saved.name }));
      onDone();
    } catch (e) {
      setSaveError(asError(e));
    } finally {
      setSaving(false);
    }
  };

  const setValue = (key: string, value: string | number | boolean) => {
    setValues((v) => ({ ...v, [key]: value }));
    setTest('idle');
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {existing ? t('storage.wizard.editTitle') : t('storage.wizard.title')}
        </DialogTitle>
        <DialogDescription>{t(`storage.wizard.steps.${step}`)}</DialogDescription>
      </DialogHeader>

      {step === 'type' && (
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label={t('storage.wizard.type')}
        >
          {STORAGE_TYPES.map((option) => {
            const Icon = STORAGE_ICONS[option];
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => {
                  setType(option);
                  setValues({});
                  setSecrets({});
                  setStep('connection');
                }}
                className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{t(`storage.types.${option}.name`)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`storage.types.${option}.summary`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {step === 'connection' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            {(() => {
              const Icon = STORAGE_ICONS[type];
              return <Icon className="size-4 text-primary" aria-hidden="true" />;
            })()}
            {t(`storage.types.${type}.name`)}
          </p>
          {fields.map((field) => (
            <StorageFieldInput
              key={field.key}
              field={field}
              type={type}
              value={field.secret ? (secrets[field.key] ?? '') : values[field.key]}
              roots={roots.data ?? []}
              storedSecret={stored.includes(field.key) && !changing.includes(field.key)}
              onChangeSecret={() => setChanging((c) => [...c, field.key])}
              onChange={(v) => {
                if (field.secret) {
                  setSecrets((s) => ({ ...s, [field.key]: String(v) }));
                  setTest('idle');
                } else setValue(field.key, v);
              }}
            />
          ))}
          {!expert && STORAGE_FIELDS[type].some((f) => f.advanced) && (
            <p className="text-xs text-muted-foreground">{t('storage.wizard.moreInExpertMode')}</p>
          )}

          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void runTest()}
              disabled={missing || test === 'running'}
            >
              {test === 'running' ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <PlugZapIcon aria-hidden="true" />
              )}
              {t('storage.wizard.test')}
            </Button>
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
          </div>
        </div>
      )}

      {step === 'folder' && (
        <div className="space-y-4">
          {expert && type !== 'local' && type !== 's3' && type !== 'smb' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="storage-start">{t('storage.wizard.startFolder')}</Label>
                <HelpTip helpKey="storage.wizard.startFolderHelp" />
              </div>
              <Input
                id="storage-start"
                value={startFolder}
                placeholder="/volume1"
                onChange={(e) => {
                  setStartFolder(e.target.value);
                  setFolder('');
                }}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('storage.wizard.folder')}</p>
            <p className="text-sm text-muted-foreground">{t('storage.wizard.folderHelp')}</p>
            <FolderBrowser
              mode="folder"
              path={folder}
              onPathChange={setFolder}
              reloadKey={startFolder}
              load={(p) => probeTarget(draft(startFolder), p, existing?.id)}
              onMakeFolder={(p, folderName) =>
                makeFolderDraft(draft(startFolder), p, folderName, existing?.id)
              }
            />
            <p className="text-sm">
              {t('storage.wizard.chosenFolder')}{' '}
              <code className="rounded bg-muted px-1 break-all">
                /{joinStoragePath(startFolder.replace(/^\/+|\/+$/g, ''), folder)}
              </code>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="storage-name">{t('storage.wizard.name')}</Label>
            <Input
              id="storage-name"
              value={name}
              placeholder={t('storage.wizard.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <ToggleRow
            id="storage-as-target"
            label={t('storage.wizard.asTarget')}
            helpKey="storage.wizard.asTargetHelp"
            checked={asTarget}
            onChange={(v) => {
              setAsTarget(v);
              if (!v) setAsSource(true);
            }}
          />
          <ToggleRow
            id="storage-as-source"
            label={t('storage.wizard.asSource')}
            helpKey="storage.wizard.asSourceHelp"
            checked={asSource}
            onChange={(v) => {
              setAsSource(v);
              if (!v) setAsTarget(true);
            }}
          />
          {asTarget && (
            <>
              <ToggleRow
                id="storage-default"
                label={t('storage.wizard.default')}
                helpKey="storage.wizard.defaultHelp"
                checked={isDefault}
                onChange={setIsDefault}
              />
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="storage-conflict">{t('storage.wizard.conflict')}</Label>
                  <HelpTip helpKey="storage.wizard.conflictHelp" />
                </div>
                <Select
                  value={conflictPolicy}
                  onValueChange={(v) => setConflictPolicy(v as typeof conflictPolicy)}
                >
                  <SelectTrigger id="storage-conflict" className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONFLICT_POLICIES.map((policy) => (
                      <SelectItem key={policy} value={policy}>
                        {t(`storage.conflict.${policy}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="storage-pattern">{t('storage.wizard.pattern')}</Label>
                  <HelpTip helpKey="storage.wizard.patternHelp" />
                </div>
                <Input
                  id="storage-pattern"
                  value={pattern}
                  placeholder="{date}/{category}"
                  onChange={(e) => setPattern(e.target.value)}
                />
              </div>
            </>
          )}
          {saveError && (
            <ErrorMessage messageKey={saveError.messageKey} details={saveError.details} />
          )}
        </div>
      )}

      {step !== 'type' && (
        <DialogFooter className="gap-2">
          {!(existing && step === 'connection') && (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => setStep(step === 'folder' ? 'connection' : 'type')}
            >
              <ChevronLeftIcon aria-hidden="true" />
              {t('storage.wizard.back')}
            </Button>
          )}
          {step === 'connection' && (
            <Button type="button" disabled={missing} onClick={() => setStep('folder')}>
              {t('storage.wizard.next')}
            </Button>
          )}
          {step === 'folder' && (
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {t('storage.wizard.save')}
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  );
}

function ToggleRow({
  id,
  label,
  helpKey,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  helpKey: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <HelpTip helpKey={helpKey} />
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StorageFieldInput({
  field,
  type,
  value,
  roots,
  storedSecret,
  onChangeSecret,
  onChange,
}: {
  field: StorageField;
  type: SupportedStorageType;
  value: string | number | boolean | undefined;
  roots: string[];
  storedSecret: boolean;
  onChangeSecret: () => void;
  onChange: (value: string | number | boolean) => void;
}) {
  const { t } = useTranslation();
  const id = `storage-field-${field.key}`;
  const label = (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id}>
        {t(field.labelKey)}
        {field.required && <span aria-hidden="true"> *</span>}
      </Label>
      <HelpTip helpKey={field.helpKey} labelKey={field.labelKey} />
    </div>
  );
  const placeholder = field.placeholderKey ? t(field.placeholderKey) : undefined;

  if (storedSecret) {
    return (
      <div className="space-y-1.5">
        {label}
        <div className="flex items-center gap-2">
          <span id={id} className="text-sm text-muted-foreground">
            {t('storage.wizard.secretStored')}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onChangeSecret}>
            {t('storage.wizard.change')}
          </Button>
        </div>
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3">
        {label}
        <Switch
          id={id}
          checked={value === true || (value === undefined && field.default === true)}
          onCheckedChange={onChange}
        />
      </div>
    );
  }

  if (field.type === 'select' || field.type === 'root') {
    const choices =
      field.type === 'root'
        ? roots.map((root) => ({ value: root, label: root }))
        : (field.choices ?? []).map((c) => ({ value: c.value, label: t(c.labelKey) }));
    return (
      <div className="space-y-1.5">
        {label}
        {field.type === 'root' && roots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('storage.wizard.noRoots')}</p>
        ) : (
          <Select value={String(value ?? field.default ?? '')} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id} className="w-full sm:w-80">
              <SelectValue placeholder={t('storage.wizard.choose')} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1.5">
        {label}
        <textarea
          id={id}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          placeholder={placeholder}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        id={id}
        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'numeric' : undefined}
        autoComplete={field.type === 'password' ? 'new-password' : 'off'}
        spellCheck={false}
        placeholder={
          placeholder ?? (field.default !== undefined ? String(field.default) : undefined)
        }
        value={value === undefined ? '' : String(value)}
        onChange={(e) =>
          onChange(
            field.type === 'number' && e.target.value !== ''
              ? Number(e.target.value)
              : e.target.value,
          )
        }
        data-storage-type={type}
      />
    </div>
  );
}
