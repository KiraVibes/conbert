import { useEffect, useState } from 'react';
import { DownloadIcon, Loader2Icon, ScrollTextIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  LOG_AREAS,
  LOG_DETAILS,
  LOG_LIMIT_LINES,
  LOG_LIMIT_MB,
  type LogArea,
  type LogEntry,
  type LogLevel,
  type LogLimit,
} from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { useLog, useLogMutations, useLogSettings, type LogFilter } from './logs-api';

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  info: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  debug: 'bg-muted text-muted-foreground',
};

/** Fields worth showing right in the line (the rest is behind "details"). */
const SUMMARY_KEYS = [
  'user',
  'ip',
  'group',
  'platform',
  'title',
  'site',
  'query',
  'name',
  'from',
  'to',
  'files',
  'failed',
  'seconds',
  'target',
  'program',
  'method',
  'path',
  'status',
  'ms',
] as const;

function errorText(entry: LogEntry, t: (key: string, o?: Record<string, unknown>) => string) {
  const key = entry.details['errorKey'];
  return typeof key === 'string' ? t(`${key}.what`, { defaultValue: key }) : null;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const { t, i18n } = useTranslation();
  const time = new Date(entry.time);
  const today = time.toDateString() === new Date().toDateString();
  const when = today
    ? time.toLocaleTimeString(i18n.language)
    : time.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const summary = SUMMARY_KEYS.flatMap((k) => {
    const v = entry.details[k];
    if (v === undefined || v === null || v === '') return [];
    return [
      `${t(`admin.log.fields.${k}`)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    ];
  });
  const error = errorText(entry, t);
  return (
    <li className="py-1.5" data-testid="log-entry">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{when}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase',
              LEVEL_CLASS[entry.level],
            )}
          >
            {t(`admin.log.levels.${entry.level}`)}
          </span>
          {entry.area && (
            <span className="text-xs text-muted-foreground">
              {t(`admin.log.areas.${entry.area}`, { defaultValue: entry.area })}
            </span>
          )}
          <span className="font-medium">
            {t(`admin.log.msg.${entry.msg}`, { defaultValue: entry.msg })}
          </span>
          {error && <span className="text-destructive">– {error}</span>}
          {summary.length > 0 && (
            <span className="w-full truncate text-xs text-muted-foreground">
              {summary.join(' · ')}
            </span>
          )}
        </summary>
        <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      </details>
    </li>
  );
}

/** Admins: how much goes into the log, how big it may get, and the log itself. */
export function LogCard() {
  const { t, i18n } = useTranslation();
  const settings = useLogSettings(true);
  const { save, clear } = useLogMutations();
  const [limitDraft, setLimitDraft] = useState<LogLimit | null>(null);
  const [filter, setFilter] = useState<LogFilter>({ level: 'debug', area: null, q: '' });
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const log = useLog(filter, live);

  // Searching waits until typing pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => setFilter((f) => ({ ...f, q: search })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fail = (error: unknown) =>
    toast.error(
      t(`${error instanceof ApiRequestError ? error.messageKey : 'errors.network'}.what`),
    );

  const s = settings.data;
  const limit = limitDraft ?? s?.limit ?? { kind: 'size', mb: LOG_LIMIT_MB.default };
  const limitValue = limit.kind === 'size' ? limit.mb : limit.count;
  const bounds = limit.kind === 'size' ? LOG_LIMIT_MB : LOG_LIMIT_LINES;
  const limitValid = limitValue >= bounds.min && limitValue <= bounds.max;
  const limitChanged = !!s && JSON.stringify(limit) !== JSON.stringify(s.limit);
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  const number = (n: number) => n.toLocaleString(i18n.language);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <ScrollTextIcon className="size-4" aria-hidden="true" />
          {t('admin.log.title')}
          <HelpTip helpKey="admin.log.help" labelKey="admin.log.title" />
        </CardTitle>
        <CardDescription>{t('admin.log.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.isError && (
          <ErrorMessage
            messageKey={
              settings.error instanceof ApiRequestError
                ? settings.error.messageKey
                : 'errors.network'
            }
          />
        )}
        {s && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                {t('admin.log.detail')}
                <HelpTip helpKey="admin.log.detailHelp" labelKey="admin.log.detail" />
              </Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={s.detail}
                onValueChange={(v) => {
                  if (!v) return;
                  save.mutate(
                    { detail: v as (typeof LOG_DETAILS)[number], limit: s.limit },
                    { onError: fail },
                  );
                }}
                aria-label={t('admin.log.detail')}
              >
                {LOG_DETAILS.map((d) => (
                  <ToggleGroupItem key={d} value={d}>
                    {t(`admin.log.details.${d}.label`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {t(`admin.log.details.${s.detail}.help`)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="log-limit" className="flex items-center gap-1.5">
                {t('admin.log.limit')}
                <HelpTip helpKey="admin.log.limitHelp" labelKey="admin.log.limit" />
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={limit.kind}
                  onValueChange={(v) => {
                    if (v === 'size') setLimitDraft({ kind: 'size', mb: LOG_LIMIT_MB.default });
                    else if (v === 'lines')
                      setLimitDraft({ kind: 'lines', count: LOG_LIMIT_LINES.default });
                  }}
                  aria-label={t('admin.log.limitKind')}
                >
                  <ToggleGroupItem value="size">{t('admin.log.bySize')}</ToggleGroupItem>
                  <ToggleGroupItem value="lines">{t('admin.log.byLines')}</ToggleGroupItem>
                </ToggleGroup>
                <Input
                  id="log-limit"
                  type="number"
                  className="w-32"
                  min={bounds.min}
                  max={bounds.max}
                  value={limitValue}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value) || 0);
                    setLimitDraft(
                      limit.kind === 'size' ? { kind: 'size', mb: n } : { kind: 'lines', count: n },
                    );
                  }}
                  aria-invalid={!limitValid}
                />
                <span className="text-sm text-muted-foreground">
                  {limit.kind === 'size' ? 'MB' : t('admin.log.linesUnit')}
                </span>
                {limitChanged && (
                  <Button
                    size="sm"
                    disabled={!limitValid || save.isPending}
                    onClick={() =>
                      save.mutate(
                        { detail: s.detail, limit },
                        {
                          onSuccess: () => {
                            setLimitDraft(null);
                            toast.success(t('admin.log.saved'));
                          },
                          onError: fail,
                        },
                      )
                    }
                  >
                    {t('admin.log.saveLimit')}
                  </Button>
                )}
              </div>
              {!limitValid && (
                <p className="text-xs text-destructive">
                  {t('admin.log.limitRange', {
                    min: number(bounds.min),
                    max: number(bounds.max),
                  })}
                </p>
              )}
              <p className="text-xs text-muted-foreground" data-testid="log-used">
                {s.enabled
                  ? t('admin.log.used', {
                      size: formatBytes(s.usedBytes, i18n.language),
                      lines: number(s.usedLines),
                    })
                  : t('admin.log.noFile')}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={filter.level}
            onValueChange={(v) => setFilter((f) => ({ ...f, level: v as LogLevel }))}
          >
            <SelectTrigger className="w-52" aria-label={t('admin.log.filterLevel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['debug', 'info', 'warn', 'error'] as const).map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`admin.log.from.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.area ?? 'all'}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, area: v === 'all' ? null : (v as LogArea) }))
            }
          >
            <SelectTrigger className="w-44" aria-label={t('admin.log.filterArea')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.log.allAreas')}</SelectItem>
              {LOG_AREAS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`admin.log.areas.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-56"
            type="search"
            placeholder={t('admin.log.search')}
            aria-label={t('admin.log.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch id="log-live" checked={live} onCheckedChange={setLive} />
            <Label htmlFor="log-live">{t('admin.log.live')}</Label>
          </div>
          <div className="ml-auto flex gap-1">
            <Button variant="outline" size="sm" asChild>
              <a href="/api/admin/logs/download" download>
                <DownloadIcon aria-hidden="true" />
                {t('admin.log.download')}
              </a>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2Icon aria-hidden="true" />
                  {t('admin.log.clear')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('admin.log.clearTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('admin.log.clearWarning')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('auth.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() =>
                      clear.mutate(undefined, {
                        onSuccess: () => toast.success(t('admin.log.cleared')),
                        onError: fail,
                      })
                    }
                  >
                    {t('admin.log.clearConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {log.isPending ? (
          <Loader2Icon className="animate-spin" aria-label={t('admin.log.loading')} />
        ) : log.isError ? (
          <ErrorMessage
            messageKey={
              log.error instanceof ApiRequestError ? log.error.messageKey : 'errors.network'
            }
          />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.log.empty')}</p>
        ) : (
          <ul
            className="max-h-[32rem] divide-y overflow-y-auto rounded-md border px-3"
            aria-label={t('admin.log.title')}
          >
            {entries.map((e) => (
              <LogLine key={e.id} entry={e} />
            ))}
          </ul>
        )}
        {log.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void log.fetchNextPage()}
            disabled={log.isFetchingNextPage}
          >
            {log.isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            {t('admin.log.older')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
