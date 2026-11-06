import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  FlaskConicalIcon,
  GripVerticalIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { EDITOR_STEP_KINDS, WORKFLOW_TEMPLATES, getFormat } from '@conbert/core';
import type { WorkflowDto, WorkflowRunDto, WorkflowStepInput } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ViewIntro } from '@/components/ViewIntro';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { uploadToServer } from '@/engines/server-convert';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { useTargets } from '@/features/storage/storage-api';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { StepEditor } from './StepEditor';
import { describeStep } from './step-text';
import {
  RUNS_KEY,
  WORKFLOWS_KEY,
  createWorkflow,
  deleteWorkflow,
  exportUrl,
  importWorkflow,
  removeRun,
  testWorkflow,
  updateWorkflow,
  useChannels,
  useWorkflowRuns,
  useWorkflows,
} from './workflows-api';

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.internal', String(e));

interface Draft {
  id?: string;
  name: string;
  steps: WorkflowStepInput[];
  keepOriginal: boolean;
}

function newStep(kind: (typeof EDITOR_STEP_KINDS)[number]): WorkflowStepInput {
  switch (kind) {
    case 'filter':
      return { kind, rule: { category: ['image'] } };
    case 'convert':
      return { kind, outputExt: 'webp', options: {} };
    case 'compress':
      return { kind, preset: 'balanced' };
    case 'edit':
      return { kind, action: 'resize', params: { maxWidth: 1920 } };
    case 'ocr':
      return { kind, options: {} };
    case 'workshop':
      return { kind, trick: 'fix-extension', params: {} };
    case 'save':
      return { kind, targetIds: [] };
    case 'notify':
      return { kind, channelIds: [] };
  }
}

/** Names of storage locations and channels for the step sentences. */
function useNames() {
  const targets = useTargets().data ?? [];
  const channels = useChannels().data ?? [];
  return {
    target: (id: string) => targets.find((x) => x.id === id)?.name ?? '?',
    channel: (id: string) => channels.find((x) => x.id === id)?.name ?? '?',
  };
}

export function WorkflowsView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const workflows = useWorkflows();
  const booruEnabled = useSettings((s) => s.booruEnabled);
  const runs = useWorkflowRuns();
  const names = useNames();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const json: unknown = JSON.parse(await file.text());
      await importWorkflow(json);
      await queryClient.invalidateQueries({ queryKey: WORKFLOWS_KEY });
      toast.success(t('workflows.imported'));
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? new ApiRequestError(0, 'errors.workflowImportInvalid')
          : asError(e),
      );
    }
  };

  if (draft) return <WorkflowEditor draft={draft} onClose={() => setDraft(null)} />;

  return (
    <div className="space-y-6">
      <ViewIntro title={t('workflows.title')} help="workflows">
        {t('workflows.intro')}
      </ViewIntro>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setDraft({ name: '', steps: [newStep('convert')], keepOriginal: false })}
        >
          <PlusIcon aria-hidden="true" />
          {t('workflows.new')}
        </Button>
        <Select
          value=""
          onValueChange={(id) => {
            const template = WORKFLOW_TEMPLATES.find((x) => x.id === id);
            if (template) {
              setDraft({
                name: t(template.nameKey),
                steps: structuredClone(template.steps) as WorkflowStepInput[],
                keepOriginal: template.keepOriginal,
              });
            }
          }}
        >
          <SelectTrigger className="w-auto" aria-label={t('workflows.fromTemplate')}>
            <SelectValue placeholder={t('workflows.fromTemplate')} />
          </SelectTrigger>
          <SelectContent>
            {WORKFLOW_TEMPLATES.filter((x) => booruEnabled || x.id !== 'booru-nas').map(
              (template) => (
                <SelectItem key={template.id} value={template.id}>
                  {t(template.nameKey)}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <UploadIcon aria-hidden="true" />
          {t('workflows.import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void doImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

      <section className="space-y-3" aria-labelledby="workflows-list">
        <h2 id="workflows-list" className="text-lg font-semibold">
          {t('workflows.list')}
        </h2>
        {workflows.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('workflows.empty')}</p>
        )}
        <ul className="space-y-3">
          {workflows.data?.map((wf) => (
            <li key={wf.id}>
              <WorkflowCard
                workflow={wf}
                describe={(s) => describeStep(s, t, names.target, names.channel)}
                onEdit={() =>
                  setDraft({
                    id: wf.id,
                    name: wf.name,
                    steps: wf.steps as WorkflowStepInput[],
                    keepOriginal: wf.keepOriginal,
                  })
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="workflow-runs">
        <h2 id="workflow-runs" className="text-lg font-semibold">
          {t('workflows.runs.title')}
        </h2>
        {runs.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('workflows.runs.empty')}</p>
        )}
        <ul className="space-y-2">
          {runs.data?.map((run) => (
            <li key={run.id}>
              <RunCard run={run} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function WorkflowCard({
  workflow,
  describe,
  onEdit,
}: {
  workflow: WorkflowDto;
  describe: (step: WorkflowStepInput) => string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <Card className="gap-2 p-3" data-testid="workflow">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">{workflow.name}</p>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <PencilIcon aria-hidden="true" />
          {t('workflows.edit.button')}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a
            href={exportUrl(workflow.id)}
            download
            aria-label={t('workflows.export', { name: workflow.name })}
          >
            <DownloadIcon aria-hidden="true" />
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('workflows.delete', { name: workflow.name })}
          onClick={() =>
            void deleteWorkflow(workflow.id).then(() =>
              queryClient.invalidateQueries({ queryKey: WORKFLOWS_KEY }),
            )
          }
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
        {(workflow.steps as WorkflowStepInput[]).map((step, i) => (
          <li key={i}>{describe(step)}</li>
        ))}
      </ol>
      {workflow.keepOriginal && (
        <p className="text-xs text-muted-foreground">{t('workflows.keepsOriginal')}</p>
      )}
    </Card>
  );
}

function WorkflowEditor({ draft: initial, onClose }: { draft: Draft; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const names = useNames();
  const [draft, setDraft] = useState(initial);
  const [dragging, setDragging] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const setSteps = (steps: WorkflowStepInput[]) => setDraft((d) => ({ ...d, steps }));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.steps.length || from === to) return;
    const steps = [...draft.steps];
    const [step] = steps.splice(from, 1);
    if (step) steps.splice(to, 0, step);
    setSteps(steps);
  };

  /** Saves and returns the workflow's ID (for the test run). */
  const save = async (close: boolean): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        steps: draft.steps,
        keepOriginal: draft.keepOriginal,
      };
      const saved = draft.id ? await updateWorkflow(draft.id, body) : await createWorkflow(body);
      setDraft((d) => ({ ...d, id: saved.id }));
      await queryClient.invalidateQueries({ queryKey: WORKFLOWS_KEY });
      if (close) {
        toast.success(t('workflows.saved'));
        onClose();
      }
      return saved.id;
    } catch (e) {
      setError(asError(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <ViewIntro title={draft.id ? t('workflows.editTitle') : t('workflows.newTitle')}>
        {t('workflows.editorIntro')}
      </ViewIntro>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wf-name">{t('workflows.name')}</Label>
          <Input
            id="wf-name"
            value={draft.name}
            placeholder={t('workflows.namePlaceholder')}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-2 sm:pt-7">
          <Switch
            id="wf-keep"
            checked={draft.keepOriginal}
            onCheckedChange={(keepOriginal) => setDraft((d) => ({ ...d, keepOriginal }))}
          />
          <Label htmlFor="wf-keep">{t('workflows.keepOriginal')}</Label>
          <HelpTip helpKey="workflows.keepOriginalHelp" labelKey="workflows.keepOriginal" />
        </div>
      </div>

      <ol className="space-y-3">
        {draft.steps.map((step, index) => (
          <li
            key={index}
            draggable
            onDragStart={() => setDragging(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, index);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={dragging === index ? 'opacity-50' : ''}
          >
            <Card className="gap-3 p-3">
              <div className="flex items-start gap-2">
                <GripVerticalIcon
                  className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    {t('workflows.stepNumber', { n: index + 1 })} ·{' '}
                    {t(`workflows.steps.${step.kind}.title`)}
                    <HelpTip
                      helpKey={`workflows.steps.${step.kind}.help`}
                      labelKey={`workflows.steps.${step.kind}.title`}
                    />
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {describeStep(step, t, names.target, names.channel)}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('workflows.moveUp')}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('workflows.moveDown')}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('workflows.removeStep')}
                  disabled={draft.steps.length === 1}
                  onClick={() => setSteps(draft.steps.filter((_, i) => i !== index))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <StepEditor
                id={`step-${index}`}
                step={step}
                onChange={(next) => setSteps(draft.steps.map((s, i) => (i === index ? next : s)))}
              />
            </Card>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value=""
          onValueChange={(kind) =>
            setSteps([...draft.steps, newStep(kind as (typeof EDITOR_STEP_KINDS)[number])])
          }
        >
          <SelectTrigger className="w-auto" aria-label={t('workflows.addStep')}>
            <PlusIcon aria-hidden="true" />
            <SelectValue placeholder={t('workflows.addStep')} />
          </SelectTrigger>
          <SelectContent>
            {EDITOR_STEP_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`workflows.steps.${kind}.title`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={saving || draft.name.trim() === ''}>
          {saving && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {t('workflows.save')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('workflows.cancel')}
        </Button>
      </div>

      <TestRun onSave={() => save(false)} disabled={draft.name.trim() === ''} />
    </div>
  );
}

/** Test run with one file from the conversion list: nothing is saved or sent. */
function TestRun({
  onSave,
  disabled,
}: {
  onSave: () => Promise<string | null>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const files = useFiles((s) => s.files);
  const runs = useWorkflowRuns();
  const [fileId, setFileId] = useState<string>('');
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const run = runs.data?.find((r) => r.id === runId);

  const start = async () => {
    const item = files.find((f) => f.id === fileId);
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const id = await onSave();
      if (!id) return;
      const serverId = await uploadToServer(item.file, item.name, undefined, () => undefined);
      setRunId((await testWorkflow(id, serverId)).id);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <h2 className="flex items-center gap-1.5 font-semibold">
        <FlaskConicalIcon className="size-4" aria-hidden="true" />
        {t('workflows.test.title')}
        <HelpTip helpKey="workflows.test.help" labelKey="workflows.test.title" />
      </h2>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('workflows.test.noFiles')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Select value={fileId} onValueChange={setFileId}>
            <SelectTrigger className="w-64 max-w-full" aria-label={t('workflows.test.file')}>
              <SelectValue placeholder={t('workflows.test.file')} />
            </SelectTrigger>
            <SelectContent>
              {files.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => void start()}
            disabled={!fileId || busy || disabled}
          >
            {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            {t('workflows.test.start')}
          </Button>
        </div>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      {run && <RunFiles run={run} preview />}
    </Card>
  );
}

function RunCard({ run }: { run: WorkflowRunDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const active = run.status === 'queued' || run.status === 'running';
  return (
    <Card className="gap-2 p-3" data-testid="workflow-run">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">
          {run.name || t('workflows.runs.quick')}
          {run.test && ` · ${t('workflows.runs.test')}`}
        </p>
        <span className="text-xs text-muted-foreground">
          {t(`workflows.runs.status.${run.status}`)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={active ? t('workflows.runs.cancel') : t('workflows.runs.remove')}
          onClick={() =>
            void removeRun(run.id).then(() => queryClient.invalidateQueries({ queryKey: RUNS_KEY }))
          }
        >
          {active ? <XIcon aria-hidden="true" /> : <Trash2Icon aria-hidden="true" />}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('workflows.runs.counts', {
          total: run.total,
          done: run.done,
          skipped: run.skipped,
          failed: run.failed,
        })}
      </p>
      {run.failed > 0 && <RunFiles run={run} onlyErrors />}
    </Card>
  );
}

/** The files of a run; failed ones with the step that stopped them (error report). */
function RunFiles({
  run,
  preview,
  onlyErrors,
}: {
  run: WorkflowRunDto;
  preview?: boolean;
  onlyErrors?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const list = onlyErrors ? run.files.filter((f) => f.status === 'error') : run.files;
  return (
    <ul className="space-y-2 text-sm">
      {list.map((file, i) => (
        <li key={i} className="space-y-1">
          <p>
            <span className="font-medium">{file.sourceName}</span> –{' '}
            {t(`workflows.runs.file.${file.status}`)}
            {file.resultName && file.status === 'done' && ` → ${file.resultName}`}
            {file.resultSize !== null && ` (${formatBytes(file.resultSize, i18n.language)})`}
          </p>
          {file.wouldSaveTo.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('workflows.test.wouldSave', { names: file.wouldSaveTo.join(', ') })}
            </p>
          )}
          {file.savedTo.length > 0 && (
            <p className="text-xs text-green-700 dark:text-green-400">
              {t('booru.jobs.savedTo', { names: file.savedTo.join(', ') })}
            </p>
          )}
          {file.error && (
            <ErrorMessage
              messageKey={file.error.messageKey}
              details={`${file.failedStep !== null ? `${t('workflows.stepNumber', { n: file.failedStep + 1 })}: ` : ''}${file.error.details ?? ''}`}
            />
          )}
          {preview &&
            file.resultFileId &&
            file.resultName &&
            getFormat(file.resultName.split('.').pop() ?? '')?.category === 'image' && (
              <img
                src={`/api/files/${file.resultFileId}/content`}
                alt={t('workflows.test.preview')}
                className="max-h-64 rounded border"
              />
            )}
        </li>
      ))}
    </ul>
  );
}
