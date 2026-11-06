import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';

/** Shown while the code of a view is fetched (only the first time). */
function ViewLoading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
      <LoaderCircleIcon
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {t('nav.viewLoading')}
    </p>
  );
}

function ViewFailed({ details }: { details: string }) {
  const { t } = useTranslation();
  return (
    <ErrorMessage
      messageKey="errors.viewFailed"
      details={details}
      actions={
        <Button size="sm" onClick={() => window.location.reload()}>
          <RotateCwIcon aria-hidden="true" />
          {t('auth.reload')}
        </Button>
      }
    />
  );
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Catches a view that can't be loaded or crashes – most often its code file
 * is gone because Conbert was updated while the page was open.
 */
class ViewBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View failed', error, info.componentStack);
  }

  override render() {
    return this.state.error ? (
      <ViewFailed details={this.state.error.message} />
    ) : (
      this.props.children
    );
  }
}

/**
 * A view whose code is loaded when it is opened. Give it a `key` per view,
 * so an error in one view doesn't stick when switching to another.
 */
export function LazyView({ children }: { children: ReactNode }) {
  return (
    <ViewBoundary>
      <Suspense fallback={<ViewLoading />}>{children}</Suspense>
    </ViewBoundary>
  );
}
