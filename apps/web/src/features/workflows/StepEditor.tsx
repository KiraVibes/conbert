import { useTranslation } from 'react-i18next';
import {
  CROP_FOCUS,
  CROP_RATIOS,
  EDIT_ACTIONS,
  FILTER_CATEGORIES,
  FORMATS,
  OCR_OPTIONS,
  WORKFLOW_COMPRESS_PRESETS,
  WORKFLOW_TRICKS,
  parseRecipients,
  type EditAction,
} from '@conbert/core';
import type { WorkflowStepInput } from '@conbert/schemas';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OptionsPanel } from '@/features/convert/OptionsPanel';
import { useTargets } from '@/features/storage/storage-api';
import { ContactChecklist } from '@/features/vault/ContactBook';
import { useContacts, useKeyDirectory, useMyKey } from '@/features/vault/vault-api';
import { useChannels } from './workflows-api';

const num = (text: string) => {
  const n = Number(text);
  return text.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : n;
};

interface StepEditorProps {
  id: string;
  step: WorkflowStepInput;
  onChange: (step: WorkflowStepInput) => void;
}

/** The fields of one step. */
export function StepEditor({ id, step, onChange }: StepEditorProps) {
  const { t } = useTranslation();
  const targets = useTargets().data?.filter((x) => x.usage.asTarget) ?? [];
  const channels = useChannels().data ?? [];

  switch (step.kind) {
    case 'filter': {
      const rule = step.rule;
      const set = (patch: Partial<typeof rule>) =>
        onChange({ ...step, rule: { ...rule, ...patch } });
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-sm font-medium">{t('workflows.fields.categories')}</legend>
            <div className="flex flex-wrap gap-3">
              {FILTER_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={rule.category?.includes(c) ?? false}
                    onChange={() => {
                      const list = rule.category ?? [];
                      const next = list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
                      set({ category: next.length > 0 ? next : undefined });
                    }}
                  />
                  {t(`workflows.categories.${c}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id={`${id}-ext`} label={t('workflows.fields.ext')}>
            <Input
              id={`${id}-ext`}
              placeholder="jpg, png"
              defaultValue={rule.ext?.join(', ') ?? ''}
              onBlur={(e) => {
                const ext = e.target.value
                  .split(/[\s,]+/)
                  .map((x) => x.replace(/^\./, '').toLowerCase())
                  .filter((x) => /^[a-z0-9]{1,10}$/.test(x));
                set({ ext: ext.length > 0 ? ext : undefined });
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id={`${id}-width`} label={t('workflows.fields.minWidth')}>
              <Input
                id={`${id}-width`}
                type="number"
                min={1}
                value={rule.minWidth ?? ''}
                onChange={(e) => set({ minWidth: num(e.target.value) })}
              />
            </Field>
            <Field id={`${id}-size`} label={t('workflows.fields.maxSizeMb')}>
              <Input
                id={`${id}-size`}
                type="number"
                min={0}
                step="any"
                value={rule.maxSizeMb ?? ''}
                onChange={(e) => set({ maxSizeMb: num(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      );
    }
    case 'convert':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-format`} label={t('workflows.fields.format')}>
            <Input
              id={`${id}-format`}
              list={`${id}-formats`}
              value={step.outputExt}
              onChange={(e) =>
                onChange({
                  ...step,
                  outputExt: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''),
                })
              }
            />
            <datalist id={`${id}-formats`}>
              {FORMATS.map((f) => (
                <option key={f.ext} value={f.ext} />
              ))}
            </datalist>
          </Field>
          <Field id={`${id}-quality`} label={t('workflows.fields.quality')}>
            <Input
              id={`${id}-quality`}
              type="number"
              min={1}
              max={100}
              placeholder={t('workflows.fields.qualityAuto')}
              value={(step.options?.['quality'] as number | undefined) ?? ''}
              onChange={(e) => {
                const quality = num(e.target.value);
                const { quality: _drop, ...rest } = step.options ?? {};
                onChange({
                  ...step,
                  options: quality ? { ...rest, quality: Math.min(100, quality) } : rest,
                });
              }}
            />
          </Field>
        </div>
      );
    case 'compress':
      return (
        <Field id={`${id}-preset`} label={t('workflows.fields.preset')}>
          <Select
            value={step.preset}
            onValueChange={(v) => onChange({ ...step, preset: v as typeof step.preset })}
          >
            <SelectTrigger id={`${id}-preset`} className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_COMPRESS_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`workflows.compress.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    case 'edit': {
      const params = step.params ?? {};
      const setParam = (key: string, value: unknown) =>
        onChange({ ...step, params: { ...params, [key]: value } });
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-action`} label={t('workflows.fields.action')}>
            <Select
              value={step.action}
              onValueChange={(v) => onChange({ ...step, action: v as EditAction, params: {} })}
            >
              <SelectTrigger id={`${id}-action`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDIT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`workflows.edit.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {step.action === 'resize' && (
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-mw`} label={t('workflows.fields.maxWidth')}>
                <Input
                  id={`${id}-mw`}
                  type="number"
                  min={1}
                  value={(params['maxWidth'] as number | undefined) ?? ''}
                  onChange={(e) => setParam('maxWidth', num(e.target.value))}
                />
              </Field>
              <Field id={`${id}-mh`} label={t('workflows.fields.maxHeight')}>
                <Input
                  id={`${id}-mh`}
                  type="number"
                  min={1}
                  value={(params['maxHeight'] as number | undefined) ?? ''}
                  onChange={(e) => setParam('maxHeight', num(e.target.value))}
                />
              </Field>
            </div>
          )}
          {step.action === 'crop' && (
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-ratio`} label={t('workflows.fields.ratio')}>
                <Select
                  value={String(params['ratio'] ?? '1:1')}
                  onValueChange={(v) => setParam('ratio', v)}
                >
                  <SelectTrigger id={`${id}-ratio`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CROP_RATIOS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`workflows.crop.ratios.${r.replace(':', 'x')}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`${id}-focus`} label={t('workflows.fields.focus')}>
                <Select
                  value={String(params['focus'] ?? 'center')}
                  onValueChange={(v) => setParam('focus', v)}
                >
                  <SelectTrigger id={`${id}-focus`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CROP_FOCUS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`workflows.crop.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <p className="col-span-2 text-xs text-muted-foreground">{t('workflows.crop.help')}</p>
            </div>
          )}
          {step.action === 'rotate' && (
            <Field id={`${id}-deg`} label={t('workflows.fields.degrees')}>
              <Select
                value={String(params['degrees'] ?? 90)}
                onValueChange={(v) => setParam('degrees', Number(v))}
              >
                <SelectTrigger id={`${id}-deg`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[90, 180, 270].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}°
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {step.action === 'rename' && (
            <Field id={`${id}-pattern`} label={t('workflows.fields.pattern')}>
              <Input
                id={`${id}-pattern`}
                value={(params['pattern'] as string | undefined) ?? '{name}'}
                onChange={(e) => setParam('pattern', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('workflows.fields.patternHelp')}</p>
            </Field>
          )}
        </div>
      );
    }
    case 'ocr':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('workflows.fields.ocrHint')}</p>
          <OptionsPanel
            idPrefix={`${id}-ocr`}
            options={OCR_OPTIONS}
            outputExt="pdf"
            values={step.options ?? {}}
            onChange={(key, value) =>
              onChange({ ...step, options: { ...step.options, [key]: value } })
            }
          />
        </div>
      );
    case 'save':
      return (
        <div className="space-y-2">
          {targets.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('workflows.fields.noTargets')}</p>
          )}
          {targets.map((target) => (
            <label key={target.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={step.targetIds.includes(target.id)}
                onChange={() =>
                  onChange({
                    ...step,
                    targetIds: step.targetIds.includes(target.id)
                      ? step.targetIds.filter((x) => x !== target.id)
                      : [...step.targetIds, target.id],
                  })
                }
              />
              {target.name}
            </label>
          ))}
          <Field id={`${id}-folder`} label={t('workflows.fields.subfolder')}>
            <Input
              id={`${id}-folder`}
              placeholder="{year}/{category}"
              value={step.subfolderPattern ?? ''}
              onChange={(e) => {
                const { subfolderPattern: _drop, ...rest } = step;
                onChange(e.target.value ? { ...rest, subfolderPattern: e.target.value } : rest);
              }}
            />
          </Field>
        </div>
      );
    case 'notify':
      return (
        <div className="space-y-2">
          {channels.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('workflows.fields.noChannels')}</p>
          )}
          {channels.map((channel) => (
            <label key={channel.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={step.channelIds.includes(channel.id)}
                onChange={() =>
                  onChange({
                    ...step,
                    channelIds: step.channelIds.includes(channel.id)
                      ? step.channelIds.filter((x) => x !== channel.id)
                      : [...step.channelIds, channel.id],
                  })
                }
              />
              {channel.name}
            </label>
          ))}
        </div>
      );
    case 'workshop': {
      const known = (WORKFLOW_TRICKS as readonly string[]).includes(step.trick);
      return (
        <Field id={`${id}-trick`} label={t('workflows.fields.trick')}>
          <Select
            value={known ? step.trick : undefined}
            onValueChange={(v) => onChange({ ...step, trick: v, params: {} })}
          >
            <SelectTrigger id={`${id}-trick`} className="w-full">
              <SelectValue placeholder={t('workflows.describe.workshop')} />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_TRICKS.map((trick) => (
                <SelectItem key={trick} value={trick}>
                  {t(`workflows.workshop.${trick}.title`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {known ? t(`workflows.workshop.${step.trick}.help`) : t('workflows.describe.workshop')}
          </p>
          {step.trick === 'encrypt' && (
            <EncryptRecipients
              params={step.params ?? {}}
              onChange={(params) => onChange({ ...step, params })}
            />
          )}
        </Field>
      );
    }
  }
}

/** Who an encrypting step encrypts for: me, users who shared their key, pasted keys. */
function EncryptRecipients({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const myKey = useMyKey().data;
  const directory = useKeyDirectory().data ?? [];
  const contacts = useContacts().data ?? [];
  const contactIds = Array.isArray(params['contactIds']) ? params['contactIds'].map(String) : [];
  const userIds = Array.isArray(params['userIds']) ? params['userIds'].map(String) : [];
  const pasted = Array.isArray(params['recipients']) ? params['recipients'].map(String) : [];
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="font-medium">{t('vault.tool.for')}</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={!myKey}
          checked={params['self'] === true}
          onChange={(e) => onChange({ ...params, self: e.target.checked })}
        />
        {myKey ? t('vault.tool.forMe') : t('vault.tool.noOwnKey')}
      </label>
      <p className="text-muted-foreground">{t('vault.contacts.pick')}</p>
      <ContactChecklist
        contacts={contacts}
        selected={contactIds}
        onChange={(ids) => onChange({ ...params, contactIds: ids })}
      />
      {directory.length > 0 && <p className="text-muted-foreground">{t('vault.contacts.users')}</p>}
      {directory.map((k) => (
        <label key={k.userId} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={userIds.includes(k.userId)}
            onChange={(e) =>
              onChange({
                ...params,
                userIds: e.target.checked
                  ? [...userIds, k.userId]
                  : userIds.filter((x) => x !== k.userId),
              })
            }
          />
          {k.displayName ? `${k.displayName} (${k.username})` : k.username}
        </label>
      ))}
      <textarea
        className="min-h-14 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
        aria-label={t('vault.tool.pasteKeys')}
        placeholder="age1…"
        defaultValue={pasted.join('\n')}
        onBlur={(e) => onChange({ ...params, recipients: parseRecipients(e.target.value).valid })}
      />
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
