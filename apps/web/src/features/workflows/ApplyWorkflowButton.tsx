import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2Icon, WorkflowIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uploadToServer } from '@/engines/server-convert';
import type { FileItem } from '@/features/convert/files-store';
import { ApiRequestError } from '@/lib/api';
import { runWorkflow, useWorkflows } from './workflows-api';

/** "Workflow anwenden": the files go to the server, the results come back into the list. */
export function ApplyWorkflowButton({
  files,
  disabled,
}: {
  files: FileItem[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows().data ?? [];
  const [busy, setBusy] = useState(false);
  if (workflows.length === 0) return null;

  const apply = async (id: string) => {
    setBusy(true);
    try {
      const fileIds = await Promise.all(
        files.map((f) => uploadToServer(f.file, f.name, undefined, () => undefined)),
      );
      await runWorkflow(id, fileIds, true);
      toast.success(t('workflows.applyStarted'));
    } catch (e) {
      const key = e instanceof ApiRequestError ? e.messageKey : 'errors.internal';
      toast.error(t(`${key}.what`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || busy || files.length === 0}>
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <WorkflowIcon aria-hidden="true" />
          )}
          {t('workflows.apply')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('workflows.applyLabel')}</DropdownMenuLabel>
        {workflows.map((wf) => (
          <DropdownMenuItem key={wf.id} onSelect={() => void apply(wf.id)}>
            {wf.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
