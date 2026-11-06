import { Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { DisplayState } from './use-display-url';

export function PreviewLoading({
  state,
  hintKey,
}: {
  state: Extract<DisplayState, { status: 'loading' }>;
  hintKey?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-md border text-sm text-muted-foreground"
      aria-live="polite"
    >
      <Loader2Icon className="size-6 animate-spin" aria-hidden="true" />
      <p>{t(state.converting ? 'preview.converting' : 'preview.loading')}</p>
      {state.converting && (
        <Progress value={state.progress} className="w-48" aria-label={t('preview.converting')} />
      )}
      {hintKey && <p className="max-w-sm text-center">{t(hintKey)}</p>}
    </div>
  );
}

export function PreviewProblem({ state }: { state: Extract<DisplayState, { status: 'error' }> }) {
  return <ErrorMessage messageKey={state.messageKey} details={state.details} />;
}
