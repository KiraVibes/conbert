import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { WorkflowRunDto } from '@conbert/schemas';
import { useFiles } from '@/features/convert/files-store';
import { markTaken, takenFiles } from '@/features/downloader/downloader-api';
import { useSettings } from '@/features/settings/settings-store';
import { apiDelete } from '@/lib/api';
import { subscribeToNotifications, subscribeToWorkflows } from '@/lib/job-socket';

/**
 * While signed in: results of finished workflow runs come into the
 * conversion list (once each), and browser notifications are shown.
 */
export function useWorkflowResults(enabled: boolean) {
  const { t } = useTranslation();
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);

  useEffect(() => {
    if (!enabled) return;
    const take = async (run: WorkflowRunDto) => {
      if (run.status !== 'done' || !run.toList || run.test) return;
      const taken = takenFiles();
      const fresh = run.files.filter((f) => f.resultFileId && !taken.has(f.resultFileId));
      if (fresh.length === 0) return;
      fresh.forEach((f) => markTaken(f.resultFileId ?? ''));
      const loaded: File[] = [];
      for (const f of fresh) {
        const response = await fetch(`/api/files/${f.resultFileId}/content`, {
          credentials: 'same-origin',
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        void apiDelete(`/api/files/${f.resultFileId}`).catch(() => undefined);
        loaded.push(new File([blob], f.resultName ?? 'result', { type: blob.type }));
      }
      if (loaded.length > 0) {
        await addFiles(loaded, defaultMode, 'convert');
        toast.success(
          t('workflows.resultsAdded', {
            count: loaded.length,
            name: run.name || t('workflows.runs.quick'),
          }),
        );
      }
    };
    const stopRuns = subscribeToWorkflows((run) => void take(run));
    const stopNotes = subscribeToNotifications((n) => {
      const values = n.values as Record<string, unknown>;
      const title = t(n.titleKey, values);
      const body = t(n.bodyKey, values);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.svg' });
      } else {
        toast.message(title, { description: body });
      }
    });
    return () => {
      stopRuns();
      stopNotes();
    };
  }, [enabled, addFiles, defaultMode, t]);
}
