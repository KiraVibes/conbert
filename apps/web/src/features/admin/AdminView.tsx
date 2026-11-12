import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIcon,
  AlertTriangleIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  CpuIcon,
  DownloadIcon,
  HardDriveIcon,
  ListChecksIcon,
  Loader2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ARCHIVE_KEEP_CHOICES, adminOverviewSchema, type AdminOverview } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ViewIntro } from '@/components/ViewIntro';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keepTimeText } from '@/features/archive/server-archive-api';
import { BlenderCard } from './BlenderCard';
import { UsersCard } from '@/features/auth/UsersCard';
import { GroupsCard } from './GroupsCard';
import { LogCard } from './LogCard';
import { LdapCard, LdapImportDialog } from './LdapCard';
import { useLdapSettings } from './ldap-api';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/features/auth/use-auth';
import { ApiRequestError, apiGet, apiPut } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

const KEY = ['admin-overview'] as const;
const GB = 1024 ** 3;
/** Quota choices in GB (plus "default" / "unlimited"). */
const SIZES = [1, 5, 10, 25, 50, 100, 250];

function Tile({
  icon: Icon,
  label,
  value,
  note,
  warn,
}: {
  icon: typeof CpuIcon;
  label: string;
  value: string;
  note?: string;
  warn?: string | null;
}) {
  return (
    <Card className="gap-1 p-4" data-testid="admin-tile">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {warn && (
        <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
          {warn}
        </p>
      )}
    </Card>
  );
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const { t, i18n } = useTranslation();
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {t('admin.ofTotal', {
            used: formatBytes(used, i18n.language),
            total: formatBytes(total, i18n.language),
          })}
        </span>
      </div>
      <Progress value={percent} className="h-2" aria-label={label} />
    </div>
  );
}

function QuotaSelect({
  value,
  onChange,
  withDefault,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  withDefault: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {withDefault && <SelectItem value="default">{t('admin.quota.default')}</SelectItem>}
        <SelectItem value="unlimited">{t('admin.quota.unlimited')}</SelectItem>
        {SIZES.map((gb) => (
          <SelectItem key={gb} value={String(gb * GB)}>
            {t('admin.quota.gb', { gb })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "3 h 12 min", "4 d 2 h". */
function uptime(seconds: number, t: (key: string, o?: Record<string, unknown>) => string) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? t('admin.uptimeDays', { d, h }) : t('admin.uptimeHours', { h, m });
}

/** For admins: how the server is doing – load, space, jobs, users, engines. */
export function AdminView() {
  const { t, i18n } = useTranslation();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: KEY,
    queryFn: () => apiGet('/api/admin/overview', adminOverviewSchema),
    enabled: me?.role === 'admin',
    refetchInterval: 5000,
  });
  const ldapOn = useLdapSettings(me?.role === 'admin').data?.enabled === true;
  if (me?.role !== 'admin') return <ErrorMessage messageKey="errors.forbidden" />;
  if (overview.isPending) {
    return <Loader2Icon className="animate-spin" aria-label={t('admin.loading')} />;
  }
  if (overview.isError) {
    const error = overview.error instanceof ApiRequestError ? overview.error : null;
    return (
      <ErrorMessage messageKey={error?.messageKey ?? 'errors.network'} details={error?.details} />
    );
  }
  const o: AdminOverview = overview.data;
  const bytes = (n: number) => formatBytes(n, i18n.language);
  const lowDisk = o.disk.free < Math.max(2 * GB, o.disk.total * 0.05);
  const usedMem = o.system.memTotal - o.system.memFree;

  const save = async (run: () => Promise<unknown>) => {
    try {
      const next = adminOverviewSchema.safeParse(await run());
      if (next.success) queryClient.setQueryData(KEY, next.data);
      toast.success(t('admin.quota.saved'));
    } catch (e) {
      toast.error(t(`${e instanceof ApiRequestError ? e.messageKey : 'errors.network'}.what`));
    }
  };
  const setUserQuota = (id: string, value: string) =>
    void save(() =>
      apiPut(`/api/admin/users/${id}/quota`, {
        quota: value === 'default' || value === 'unlimited' ? value : Number(value),
      }),
    );
  const setDefault = (value: string) =>
    void save(() =>
      apiPut('/api/admin/quota-default', { bytes: value === 'unlimited' ? null : Number(value) }),
    );
  const setArchiveKeep = (value: string) =>
    void save(() => apiPut('/api/admin/archive-keep', { hours: Number(value) }));

  return (
    <div className="space-y-6">
      <ViewIntro title={t('admin.title')} help="admin">
        {t('admin.intro')} <HelpTip helpKey="admin.help" labelKey="admin.title" />
      </ViewIntro>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={ActivityIcon}
          label={t('admin.tiles.jobs')}
          value={String(o.jobs.running)}
          note={t('admin.tiles.jobsNote', { queued: o.jobs.queued, done: o.jobs.done24h })}
          warn={o.jobs.queueHealthy ? null : t('admin.queueDown')}
        />
        <Tile
          icon={CircleXIcon}
          label={t('admin.tiles.failed')}
          value={String(o.jobs.failed24h)}
          note={t('admin.tiles.failedNote')}
        />
        <Tile
          icon={HardDriveIcon}
          label={t('admin.tiles.free')}
          value={bytes(o.disk.free)}
          note={t('admin.tiles.freeNote', { total: bytes(o.disk.total) })}
          warn={lowDisk ? t('admin.diskLow') : null}
        />
        <Tile
          icon={CpuIcon}
          label={t('admin.tiles.load')}
          value={(o.system.load[0] ?? 0).toLocaleString(i18n.language)}
          note={t('admin.tiles.loadNote', { cpus: o.system.cpus })}
          warn={(o.system.load[0] ?? 0) > o.system.cpus ? t('admin.busy') : null}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.storage.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter
              label={t('admin.storage.disk', { path: o.disk.path })}
              used={o.disk.total - o.disk.free}
              total={o.disk.total}
            />
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('admin.storage.uploads')}</dt>
              <dd className="tabular-nums">{bytes(o.disk.uploads)}</dd>
              <dt className="text-muted-foreground">{t('admin.storage.tmp')}</dt>
              <dd className="tabular-nums">{bytes(o.disk.tmp)}</dd>
              <dt className="text-muted-foreground">{t('admin.storage.models')}</dt>
              <dd className="tabular-nums">{bytes(o.disk.models)}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t('admin.storage.note')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin.system.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label={t('admin.system.memory')} used={usedMem} total={o.system.memTotal} />
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('admin.system.conbert')}</dt>
              <dd className="tabular-nums">{bytes(o.system.processMemory)}</dd>
              <dt className="text-muted-foreground">{t('admin.system.loadAll')}</dt>
              <dd className="tabular-nums">
                {o.system.load.map((l) => l.toLocaleString(i18n.language)).join(' · ')}
              </dd>
              <dt className="text-muted-foreground">{t('admin.system.uptime')}</dt>
              <dd>{uptime(o.system.uptimeSeconds, t)}</dd>
              <dt className="text-muted-foreground">{t('admin.system.version')}</dt>
              <dd>
                Conbert {o.system.version} · Node {o.system.node} · {o.system.platform}
              </dd>
              <dt className="text-muted-foreground">{t('admin.system.downloads')}</dt>
              <dd className="flex items-center gap-1 tabular-nums">
                <DownloadIcon className="size-3.5" aria-hidden="true" />
                {t('admin.system.downloadsValue', o.downloads)}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            {t('admin.users.title')}
            <HelpTip helpKey="admin.users.help" labelKey="admin.users.title" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('admin.users.defaultQuota')}</span>
            <QuotaSelect
              value={o.quotaDefault === null ? 'unlimited' : String(o.quotaDefault)}
              onChange={setDefault}
              withDefault={false}
              label={t('admin.users.defaultQuota')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-1">
              {t('admin.archiveKeep.label')}
              <HelpTip helpKey="admin.archiveKeep.help" labelKey="admin.archiveKeep.label" />
            </span>
            <Select value={String(o.archiveKeepHours)} onValueChange={setArchiveKeep}>
              <SelectTrigger className="w-44" aria-label={t('admin.archiveKeep.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARCHIVE_KEEP_CHOICES.map((hours) => (
                  <SelectItem key={hours} value={String(hours)}>
                    {keepTimeText(t, hours)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ul className="divide-y rounded-lg border">
            {o.users.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                data-testid="admin-user"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">
                    {u.username}
                    {u.role === 'admin' && (
                      <span className="text-muted-foreground"> · {t('admin.users.admin')}</span>
                    )}
                  </p>
                  {u.quotaBytes === null ? (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {t('admin.users.usedNoLimit', { used: bytes(u.usedBytes) })}
                    </p>
                  ) : (
                    <Meter label={t('admin.users.used')} used={u.usedBytes} total={u.quotaBytes} />
                  )}
                </div>
                <QuotaSelect
                  value={u.quotaSetting === 'custom' ? String(u.quotaBytes) : u.quotaSetting}
                  onChange={(v) => setUserQuota(u.id, v)}
                  withDefault
                  label={t('admin.users.quotaFor', { name: u.username })}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.jobs.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {o.jobs.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.jobs.none')}</p>
          ) : (
            <ul className="space-y-3" aria-label={t('admin.jobs.active')}>
              {o.jobs.active.map((j) => (
                <li key={j.id} className="space-y-1">
                  <p className="text-sm">
                    <span className="font-medium uppercase">
                      {j.inputExt} → {j.outputExt}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {j.user} ·{' '}
                      {j.status === 'queued'
                        ? t('admin.jobs.queued')
                        : t(`stages.${j.stage ?? 'converting'}`)}
                    </span>
                  </p>
                  <Progress
                    value={j.progress}
                    className="h-1.5"
                    aria-label={`${j.inputExt} → ${j.outputExt}`}
                  />
                </li>
              ))}
            </ul>
          )}
          {o.jobs.recentErrors.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('admin.jobs.errors')}</p>
              <ul className="space-y-1 text-sm">
                {o.jobs.recentErrors.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <CircleXIcon
                      className="mt-0.5 size-4 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <span>
                      <span className="uppercase">
                        {e.inputExt} → {e.outputExt}
                      </span>{' '}
                      · {e.user} ·{' '}
                      {new Date(e.createdAt).toLocaleTimeString(i18n.language, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      : {t(`${e.errorKey}.what`, { defaultValue: e.errorKey })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <LogCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ListChecksIcon className="size-4" aria-hidden="true" />
              {t('admin.engines.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {o.engines.map((e) => (
                <li key={e.id} className="flex items-center gap-1.5">
                  {e.status === 'error' ? (
                    <CircleXIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  ) : e.status === 'uninitialized' ? (
                    <CircleDashedIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleCheckIcon
                      className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{e.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      e.status === 'error'
                        ? 'admin.engines.broken'
                        : e.status === 'uninitialized'
                          ? 'admin.engines.notInstalled'
                          : 'admin.engines.ok',
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.models.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-1 text-sm">
              {o.models.map((m) => (
                <li key={`${m.kind}-${m.id}`} className="flex justify-between gap-2">
                  <span>
                    {t(`admin.models.kinds.${m.kind}`)}: {m.id}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {m.installed ? bytes(m.bytes) : t('admin.models.notLoaded')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('admin.metrics')} <code>/api/metrics</code>
            </p>
          </CardContent>
        </Card>
      </div>
      <UsersCard />
      <GroupsCard importButton={ldapOn ? <LdapImportDialog /> : undefined} />
      <LdapCard />
      <BlenderCard />
    </div>
  );
}
