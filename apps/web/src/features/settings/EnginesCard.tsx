import { CloudIcon, MonitorIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EngineDescriptor, EngineStatus } from '@conbert/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEngineStatus } from '@/engines/engine-status-store';
import { browserEngines } from '@/engines/registry';
import { useServerEngines, useServerHardware } from '@/engines/use-engines';
import { HelpTip } from '@/components/HelpTip';

const STATUS_STYLE: Record<EngineStatus, string> = {
  uninitialized: 'bg-muted text-muted-foreground',
  loading: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  error: 'bg-destructive/10 text-destructive',
};

function EngineRow({ engine, status }: { engine: EngineDescriptor; status: EngineStatus }) {
  const { t } = useTranslation();
  const formats = engine.formats.length;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-0.5">
        <p className="flex items-center gap-2 font-medium">
          {engine.runtime === 'browser' ? (
            <MonitorIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <CloudIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {engine.name}
          <span className="text-xs font-normal text-muted-foreground">
            {t('settings.engines.formats', { count: formats })}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{t(engine.descriptionKey)}</p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge tabIndex={0} className={STATUS_STYLE[status]}>
            {t(`engineStatus.${status}`)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{t(`engineStatus.${status}Help`)}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Which engines exist, where they run and whether they are loaded. */
export function EnginesCard() {
  const { t } = useTranslation();
  const statuses = useEngineStatus((s) => s.engines);
  const serverEngines = useServerEngines();
  const hardware = useServerHardware();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.engines.title')}</CardTitle>
        <CardDescription>{t('settings.engines.intro')}</CardDescription>
      </CardHeader>
      <CardContent>
        {hardware && (
          <div
            data-testid="gpu-status"
            className={
              hardware.gpu
                ? 'mb-3 flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm'
                : 'mb-3 flex items-start gap-2 rounded-lg bg-muted p-3 text-sm'
            }
          >
            <span aria-hidden="true">{hardware.gpu ? '🚀' : '🖥'}</span>
            <span className="flex-1">
              {hardware.gpu
                ? t('settings.gpu.found', { gpu: t(`settings.gpu.kinds.${hardware.gpu}`) })
                : t('settings.gpu.none')}
            </span>
            <HelpTip helpKey="settings.gpu.help" labelKey="settings.gpu.label" />
          </div>
        )}
        <ul className="divide-y">
          {browserEngines.map((engine) => (
            <EngineRow
              key={`browser-${engine.id}`}
              engine={{ ...engine, status: engine.status() }}
              status={statuses[engine.id]?.status ?? engine.status()}
            />
          ))}
          {serverEngines.map((engine) => (
            <EngineRow key={`server-${engine.id}`} engine={engine} status={engine.status} />
          ))}
        </ul>
        {serverEngines.length === 0 && (
          <p className="pt-2 text-sm text-muted-foreground">{t('settings.engines.noServer')}</p>
        )}
      </CardContent>
    </Card>
  );
}
