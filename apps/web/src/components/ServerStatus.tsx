import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useServerHealth } from '@/lib/use-server-health';
import { cn } from '@/lib/utils';

/** Small dot + label showing whether the Conbert server is reachable. */
export function ServerStatus() {
  const { t } = useTranslation();
  const health = useServerHealth();
  const state = health.isPending
    ? 'checking'
    : !health.isSuccess
      ? 'offline'
      : health.data.queue === 'unavailable'
        ? 'degraded'
        : 'online';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          tabIndex={0}
          className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              state === 'online' && 'bg-emerald-500',
              state === 'offline' && 'bg-red-500',
              state === 'checking' && 'animate-pulse bg-amber-400',
              state === 'degraded' && 'bg-amber-500',
            )}
          />
          {t(`server.${state}`)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t(`server.${state}Help`)}</TooltipContent>
    </Tooltip>
  );
}
