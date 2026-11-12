import { useCallback, useEffect, useState } from 'react';
import { pendingSharedLink } from '@/lib/share-target';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  DownloadIcon,
  FileIcon,
  FilmIcon,
  ImageIcon,
  MusicIcon,
  InfoIcon,
  ListPlusIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DEFAULT_DOWNLOAD_LIMIT,
  DOWNLOAD_QUALITIES,
  canSubscribe,
  DEFAULT_PIXIV_OPTIONS,
  getFormat,
  MAX_DOWNLOAD_LIMIT,
  profilePartsFor,
  UGOIRA_FORMATS,
  type DownloadQuality,
  type PixivOptions,
  type ProfilePart,
  type UgoiraFormat,
} from '@conbert/core';
import {
  DEFAULT_ARCHIVE_KEEP_HOURS,
  type DownloadDto,
  type DownloadedFile,
  type ProbeDownloadResponse,
} from '@conbert/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { TimeStamp } from '@/components/TimeStamp';
import { ViewIntro } from '@/components/ViewIntro';
import {
  archiveZipUrl,
  keepTimeText,
  useServerArchive,
} from '@/features/archive/server-archive-api';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { useTargets } from '@/features/storage/storage-api';
import { FeedsSection } from '@/features/subscriptions/FeedsSection';
import { SaveFeedPanel } from '@/features/subscriptions/SaveFeedPanel';
import { AfterSelect } from '@/features/workflows/AfterSelect';
import { afterFromValue } from '@/features/workflows/after-actions';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { cardTimeKey } from '@/lib/stamp';
import {
  DOWNLOADS_KEY,
  cancelOrRemove,
  fetchDownloadedFiles,
  markTaken,
  probeLink,
  startDownload,
  takenFiles,
  useDownloads,
} from './downloader-api';
import { DeviantartProbeHint } from './DeviantartSection';

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network', String(e));

const formatDuration = (seconds: number) => {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
};

/** Social-media downloader: paste a link, check it, download, hand over to the list. */
export function DownloaderView() {
  const { t } = useTranslation();
  // A link shared from another app ("Share → Conbert") is checked right away.
  const [shared] = useState(pendingSharedLink);
  const [url, setUrl] = useState(shared ?? '');
  const [probe, setProbe] = useState<ProbeDownloadResponse | null>(null);
  const [checking, setChecking] = useState(shared !== null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);

  /** Puts downloaded files into the conversion list (each file only once). */
  const takeOver = useCallback(
    async (files: DownloadedFile[], announce: boolean, keep: boolean) => {
      const taken = takenFiles();
      const fresh = files.filter((f) => f.onServer && !taken.has(f.fileId));
      if (fresh.length === 0) return;
      fresh.forEach((f) => markTaken(f.fileId));
      try {
        const loaded = await fetchDownloadedFiles(fresh, !keep);
        await addFiles(loaded, defaultMode, 'convert');
        if (announce) toast.success(t('downloader.added', { count: loaded.length }));
      } catch {
        toast.error(t('downloader.gone'));
      }
    },
    [addFiles, defaultMode, t],
  );

  // While this page is open, every finished file goes straight into the list
  // (if that was chosen) – not only when the whole channel is done.
  const onUpdate = useCallback(
    (download: DownloadDto) => {
      if (download.toList && download.files.length > 0) {
        void takeOver(download.files, download.status === 'done', download.keepOnServer);
      }
    },
    [takeOver],
  );
  const downloads = useDownloads(onUpdate);

  const checkLink = useCallback(async (link: string) => {
    setChecking(true);
    setError(null);
    setProbe(null);
    try {
      setProbe(await probeLink(link));
    } catch (e) {
      setError(asError(e));
    } finally {
      setChecking(false);
    }
  }, []);
  const check = async (event: React.FormEvent) => {
    event.preventDefault();
    await checkLink(url);
  };
  useEffect(() => {
    if (!shared) return;
    let active = true;
    toast.info(t('downloader.sharedLink'));
    probeLink(shared)
      .then((result) => active && setProbe(result))
      .catch((e: unknown) => active && setError(asError(e)))
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [shared, t]);

  return (
    <div className="space-y-6">
      <ViewIntro title={t('downloader.title')} help="download">
        {t('downloader.intro')}
      </ViewIntro>
      <p className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {t('downloader.legalHint')}
      </p>

      <form onSubmit={(e) => void check(e)} className="flex flex-col gap-2 sm:flex-row">
        <Label htmlFor="download-url" className="sr-only">
          {t('downloader.urlLabel')}
        </Label>
        <Input
          id="download-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('downloader.urlPlaceholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" disabled={checking || url.trim() === ''}>
          {checking ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <SearchIcon aria-hidden="true" />
          )}
          {t('downloader.check')}
        </Button>
      </form>
      {checking && <p className="text-sm text-muted-foreground">{t('downloader.checking')}</p>}
      {error && (
        <ErrorMessage
          messageKey={error.messageKey}
          details={error.details}
          actions={
            error.code === 'DOWNLOAD_LOGIN_REQUIRED' || error.code === 'DOWNLOAD_PIXIV_LOGIN' ? (
              <Button size="sm" variant="outline" asChild>
                <a href="#/settings">{t('downloader.toSettings')}</a>
              </Button>
            ) : undefined
          }
        />
      )}
      {probe && <ProbeCard key={probe.probeId} probe={probe} onStarted={() => setProbe(null)} />}

      <FeedsSection foldable />
      <section className="space-y-3" aria-labelledby="downloads-title">
        <h2 id="downloads-title" className="text-lg font-semibold">
          {t('downloader.list.title')}
        </h2>
        {downloads.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('downloader.list.empty')}</p>
        )}
        <ul className="space-y-3">
          {downloads.data?.map((download) => (
            <li key={download.id}>
              <DownloadRow
                download={download}
                onTake={() => void takeOver(download.files, true, download.keepOnServer)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ProbeCard({ probe, onStarted }: { probe: ProbeDownloadResponse; onStarted: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sleepSeconds = useSettings((s) => s.downloaderSleepSeconds);
  const [quality, setQuality] = useState<DownloadQuality>('best');
  const parts = profilePartsFor(probe.platform);
  const [chosenParts, setChosenParts] = useState<ProfilePart[]>(parts.length > 0 ? ['posts'] : []);
  const isPixiv = probe.platform === 'pixiv';
  const [pixiv, setPixiv] = useState<PixivOptions>(DEFAULT_PIXIV_OPTIONS);
  const [limit, setLimit] = useState(DEFAULT_DOWNLOAD_LIMIT);
  const [dateAfter, setDateAfter] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [thumbnail, setThumbnail] = useState(probe.thumbnail);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const many = probe.kind !== 'single';
  // Where the files go: the conversion list and/or storage locations (default preselected).
  const targets = (useTargets().data ?? []).filter((target) => target.usage.asTarget);
  // Until the user changes it, the default location is chosen – also when the
  // list of locations arrives only after this card appeared.
  const [chosenTargets, setChosenTargets] = useState<string[] | null>(null);
  const targetIds =
    chosenTargets ?? targets.filter((target) => target.isDefault).map((target) => target.id);
  const [after, setAfter] = useState('');
  // Without a default location the files stay in the server archive; with
  // one they go there and into the list (until the user changes it).
  const hasDefault = targets.some((target) => target.isDefault);
  const archiveKeepHours = useServerArchive().data?.keepHours ?? DEFAULT_ARCHIVE_KEEP_HOURS;
  const [chosenList, setToList] = useState<boolean | null>(null);
  const [chosenKeep, setKeepOnServer] = useState<boolean | null>(null);
  const toList = chosenList ?? hasDefault;
  const keepOnServer = chosenKeep ?? !hasDefault;
  const [skipKnown, setSkipKnown] = useState(true);
  const noDestination = !toList && !keepOnServer && targetIds.length === 0;
  const loginHint = probe.platform === 'instagram' || chosenParts.some((p) => p !== 'posts');

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await startDownload({
        url: probe.url,
        probeId: probe.probeId,
        quality,
        parts: chosenParts,
        ...(isPixiv && { pixiv }),
        limit: many ? limit : 1,
        sleepSeconds,
        toList,
        keepOnServer,
        after: afterFromValue(after),
        targetIds,
        skipKnown: many && skipKnown,
        ...(many && dateAfter && { dateAfter }),
        ...(many && dateBefore && { dateBefore }),
      });
      await queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
      onStarted();
    } catch (e) {
      setError(asError(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className="gap-4 p-4" data-testid="probe-card">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
        {thumbnail && (
          <img
            src={`/api/downloader/probes/${probe.probeId}/thumbnail`}
            alt=""
            className="aspect-video w-full shrink-0 rounded-md bg-muted object-cover sm:w-48"
            onError={() => setThumbnail(false)}
          />
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-1.5">
            <Badge>{t(`downloader.platforms.${probe.platform}`)}</Badge>
            <Badge variant="secondary">{t(`downloader.kind.${probe.kind}`)}</Badge>
          </div>
          <p className="font-medium break-words">{probe.title ?? probe.url}</p>
          <p className="text-sm text-muted-foreground">
            {[
              probe.uploader && t('downloader.by', { name: probe.uploader }),
              many &&
                (probe.count
                  ? t('downloader.items', { count: probe.count })
                  : t('downloader.itemsMany')),
              probe.duration && t('downloader.duration', { time: formatDuration(probe.duration) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {probe.entries.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('downloader.firstEntries')}
              </summary>
              <ol className="mt-1 list-decimal pl-5">
                {probe.entries.map((entry, i) => (
                  <li key={i} className="truncate">
                    {entry}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>

      {probe.platform === 'deviantart' && <DeviantartProbeHint />}

      {probe.hasCookies ? (
        <p className="text-sm text-muted-foreground">
          {isPixiv
            ? t('downloader.pixiv.connectedHint')
            : t('downloader.hasCookies', {
                platform: t(`downloader.platforms.${probe.platform}`),
              })}
        </p>
      ) : (
        loginHint && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {t('downloader.needsCookies', {
              platform: t(`downloader.platforms.${probe.platform}`),
            })}
            <a href="#/settings" className="font-medium underline">
              {t('downloader.toSettings')}
            </a>
          </p>
        )
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {probe.tool === 'yt-dlp' && (
          <Field
            id="dl-quality"
            labelKey="downloader.quality.label"
            helpKey="downloader.quality.help"
          >
            <Select value={quality} onValueChange={(v) => setQuality(v as DownloadQuality)}>
              <SelectTrigger id="dl-quality" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOWNLOAD_QUALITIES.map((q) => (
                  <SelectItem key={q} value={q}>
                    {t(`downloader.quality.${q}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`downloader.quality.${quality}Help`)}
            </p>
          </Field>
        )}
        {isPixiv && (
          <Field
            id="dl-ugoira"
            labelKey="downloader.pixiv.ugoira.label"
            helpKey="downloader.pixiv.ugoira.help"
          >
            <Select
              value={pixiv.ugoira}
              onValueChange={(v) => setPixiv((p) => ({ ...p, ugoira: v as UgoiraFormat }))}
            >
              <SelectTrigger id="dl-ugoira" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UGOIRA_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`downloader.pixiv.ugoira.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`downloader.pixiv.ugoira.${pixiv.ugoira}Help`)}
            </p>
          </Field>
        )}
        {isPixiv && (
          <div className="flex items-start gap-2 sm:col-span-2">
            <Switch
              id="dl-pixiv-adult"
              checked={pixiv.adult}
              onCheckedChange={(adult) => setPixiv((p) => ({ ...p, adult }))}
            />
            <Label htmlFor="dl-pixiv-adult" className="flex items-center gap-1.5">
              {t('downloader.pixiv.adult.label')}
              <HelpTip
                helpKey="downloader.pixiv.adult.help"
                labelKey="downloader.pixiv.adult.label"
              />
            </Label>
          </div>
        )}
        {many && (
          <Field id="dl-limit" labelKey="downloader.limit.label" helpKey="downloader.limit.help">
            <Input
              id="dl-limit"
              type="number"
              min={1}
              max={MAX_DOWNLOAD_LIMIT}
              value={limit}
              onChange={(e) =>
                setLimit(
                  Math.min(
                    MAX_DOWNLOAD_LIMIT,
                    Math.max(1, Math.round(Number(e.target.value) || 1)),
                  ),
                )
              }
            />
            {limit > 200 && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {t('downloader.limit.many')}
              </p>
            )}
          </Field>
        )}
        {probe.kind === 'profile' && parts.length > 0 && (
          <fieldset className="space-y-1.5 sm:col-span-2">
            <legend className="flex items-center gap-1.5 text-sm font-medium">
              {t('downloader.parts.label')}
              <HelpTip helpKey="downloader.parts.help" labelKey="downloader.parts.label" />
            </legend>
            <div className="flex flex-wrap gap-3">
              {parts.map((part) => (
                <label key={part} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={chosenParts.includes(part)}
                    onChange={() =>
                      setChosenParts((c) =>
                        c.includes(part) ? c.filter((p) => p !== part) : [...c, part],
                      )
                    }
                  />
                  {t(`downloader.parts.${part}`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {many && (
          <fieldset className="space-y-1.5 sm:col-span-2">
            <legend className="flex items-center gap-1.5 text-sm font-medium">
              {t('downloader.period.label')}
              <HelpTip helpKey="downloader.period.help" labelKey="downloader.period.label" />
            </legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                {t('downloader.period.after')}
                <Input
                  type="date"
                  value={dateAfter}
                  onChange={(e) => setDateAfter(e.target.value)}
                  className="w-auto"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                {t('downloader.period.before')}
                <Input
                  type="date"
                  value={dateBefore}
                  onChange={(e) => setDateBefore(e.target.value)}
                  className="w-auto"
                />
              </label>
            </div>
          </fieldset>
        )}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          {t('downloader.destination.label')}
          <HelpTip helpKey="downloader.destination.help" labelKey="downloader.destination.label" />
        </legend>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={keepOnServer}
              onChange={(e) => setKeepOnServer(e.target.checked)}
            />
            {t('downloader.destination.server', {
              time: keepTimeText(t, archiveKeepHours),
            })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={toList}
              onChange={(e) => setToList(e.target.checked)}
            />
            {t('downloader.destination.list')}
          </label>
          {targets.map((target) => (
            <label key={target.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={targetIds.includes(target.id)}
                onChange={() =>
                  setChosenTargets(
                    targetIds.includes(target.id)
                      ? targetIds.filter((x) => x !== target.id)
                      : [...targetIds, target.id],
                  )
                }
              />
              {t('downloader.destination.target', { name: target.name })}
            </label>
          ))}
        </div>
        {toList && many && (
          <p className="text-xs text-muted-foreground">{t('downloader.destination.listMany')}</p>
        )}
        {keepOnServer && (
          <p className="text-xs text-muted-foreground">
            {t('downloader.destination.serverHint')}{' '}
            <a href="#/archive/server" className="underline">
              {t('downloader.destination.serverOpen')}
            </a>
          </p>
        )}
        {!toList && !keepOnServer && targetIds.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('downloader.destination.onlyTargets')}</p>
        )}
        {noDestination && (
          <p className="text-xs text-destructive">{t('downloader.destination.none')}</p>
        )}
      </fieldset>

      {many && (
        <div className="flex items-start gap-2">
          <Switch id="skip-known" checked={skipKnown} onCheckedChange={setSkipKnown} />
          <div className="space-y-0.5">
            <Label htmlFor="skip-known" className="flex items-center gap-1">
              {t('downloader.skipKnown')}
              <HelpTip helpKey="downloader.skipKnownHelp" labelKey="downloader.skipKnown" />
            </Label>
          </div>
        </div>
      )}
      <AfterSelect id="after-select" value={after} onChange={setAfter} />
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div>
        <Button
          onClick={() => void start()}
          disabled={
            starting ||
            noDestination ||
            (parts.length > 0 && probe.kind === 'profile' && chosenParts.length === 0)
          }
        >
          {starting ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          {t('downloader.start')}
        </Button>
      </div>
      {canSubscribe(probe.platform, probe.kind) && (
        <SaveFeedPanel
          probe={probe}
          disabled={
            noDestination ||
            (parts.length > 0 && probe.kind === 'profile' && chosenParts.length === 0)
          }
          options={{
            quality,
            parts: chosenParts,
            ...(isPixiv && { pixiv }),
            limit,
            sleepSeconds,
            toList,
            keepOnServer,
            after: afterFromValue(after),
            targetIds,
          }}
          onSaved={onStarted}
        />
      )}
    </Card>
  );
}

function Field({
  id,
  labelKey,
  helpKey,
  children,
}: {
  id: string;
  labelKey: string;
  helpKey: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{t(labelKey)}</Label>
        <HelpTip helpKey={helpKey} labelKey={labelKey} />
      </div>
      {children}
    </div>
  );
}

export function DownloadRow({ download, onTake }: { download: DownloadDto; onTake: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const active = download.status === 'queued' || download.status === 'running';
  const remove = async () => {
    await cancelOrRemove(download.id).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
  };
  const ready = download.files.length;
  // New files vs. ones that were there before (skipped by the archive, or
  // already at the storage location).
  const alreadyAtTarget = download.files.filter((f) => f.alreadyThere).length;
  const fresh = ready - alreadyAtTarget;
  const before = download.known + alreadyAtTarget;
  // Files still on the server that this browser has not put into the list yet.
  const onServer = download.files.filter((f) => f.onServer && !takenFiles().has(f.fileId)).length;
  // Kept in the server archive: all of them can be fetched as one ZIP.
  const archived = download.keepOnServer
    ? download.files.filter((f) => f.onServer).map((f) => f.fileId)
    : [];
  return (
    <Card className="gap-2 p-3" data-testid="download-row">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={download.title ?? download.url}>
            {download.title ?? download.url}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`downloader.platforms.${download.platform}`)} ·{' '}
            {t(`downloader.status.${download.status}`)}
            {ready > 0 && ` · ${t('downloader.files', { count: ready })}`}
          </p>
          <TimeStamp
            labelKey={cardTimeKey(download.status, !!download.feedId)}
            iso={download.finishedAt ?? download.createdAt}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void remove()}
          aria-label={active ? t('downloader.list.cancel') : t('downloader.list.remove')}
        >
          {active ? <XIcon aria-hidden="true" /> : <Trash2Icon aria-hidden="true" />}
        </Button>
      </div>
      {download.recordOnly && (
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="download-recorded">
          {t('downloader.recordOnly', { count: download.known })}
        </p>
      )}
      {!download.recordOnly && (fresh > 0 || before > 0) && (
        <p className="text-xs tabular-nums" data-testid="download-counts">
          <span className="font-medium text-green-700 dark:text-green-400">
            {t('downloader.counts.new', { count: fresh })}
          </span>
          {' · '}
          <span className="text-muted-foreground">
            {t('downloader.counts.before', { count: before })}
          </span>
        </p>
      )}
      {active && (
        <div className="space-y-1">
          <Progress
            value={download.progress}
            aria-label={t(`downloader.status.${download.status}`)}
          />
          {download.status === 'running' && !download.recordOnly && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {/* Counts finished files – the bar itself never runs backwards. */}
              {download.total
                ? t('downloader.itemOf', {
                    current: Math.min(ready + 1, download.total),
                    total: download.total,
                  })
                : t('downloader.itemOfUnknown', { current: ready + 1 })}
              {ready > 0 && ` · ${t('downloader.readyCount', { count: ready })}`}
            </p>
          )}
        </div>
      )}
      {ready > 0 && (
        <ul
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          aria-label={t('downloader.tilesLabel')}
        >
          {download.files.map((file) => (
            <li key={file.fileId}>
              <FileTile file={file} keep={download.keepOnServer} />
            </li>
          ))}
        </ul>
      )}
      {(download.status === 'done' ||
        download.status === 'cancelled' ||
        download.status === 'error') && (
        <div className="space-y-1 text-sm">
          {download.nothingNew && (
            <p className="text-muted-foreground">{t('downloader.nothingNew')}</p>
          )}
          {download.skipped > 0 && (
            <p className="text-amber-800 dark:text-amber-300">
              {t('downloader.skipped', { count: download.skipped })}
            </p>
          )}
          {(onServer > 0 || archived.length > 1) && (
            <div className="flex flex-wrap gap-2">
              {archived.length > 1 && (
                <Button size="sm" variant="outline" asChild>
                  <a href={archiveZipUrl(archived)} download="conbert-download.zip">
                    <DownloadIcon aria-hidden="true" />
                    {t('archive.downloadAll')}
                  </a>
                </Button>
              )}
              {onServer > 0 && (
                <Button size="sm" variant="outline" onClick={onTake}>
                  <ListPlusIcon aria-hidden="true" />
                  {t('downloader.addToList')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {download.status === 'error' && download.error && (
        <ErrorMessage messageKey={download.error.messageKey} details={download.error.details} />
      )}
    </Card>
  );
}

const CATEGORY_ICONS = {
  image: ImageIcon,
  video: FilmIcon,
  audio: MusicIcon,
} as const;

/** One finished file of a download: picture or icon, name, size, where it went. */
function FileTile({ file, keep }: { file: DownloadedFile; keep: boolean }) {
  const { t, i18n } = useTranslation();
  const category = getFormat(file.ext)?.category;
  const Icon =
    (category && category in CATEGORY_ICONS
      ? CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS]
      : undefined) ?? FileIcon;
  // The server's small cover (site thumbnail, picture, video frame or music
  // cover); without one, small pictures show themselves, the rest an icon.
  const cover = file.thumbnail
    ? `/api/downloader/thumbs/${file.fileId}`
    : category === 'image' && file.onServer && file.size < 8 * 1024 * 1024
      ? `/api/files/${file.fileId}/content`
      : null;
  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-md border"
      data-testid="download-tile"
    >
      <div className="flex aspect-video items-center justify-center bg-muted">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 space-y-0.5 p-2">
        <p className="truncate text-xs font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size, i18n.language)}</p>
        {file.alreadyThere ? (
          <p className="text-xs text-muted-foreground">{t('downloader.alreadyThere')}</p>
        ) : (
          file.savedTo.length > 0 && (
            <p className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <CheckIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{file.savedTo.join(', ')}</span>
            </p>
          )
        )}
        {file.saveError && (
          <p className="text-xs text-destructive" title={t(`${file.saveError}.what`)}>
            {t('downloader.saveFailed')}
          </p>
        )}
      </div>
      {/* Taken into the list without the archive = the server copy is gone. */}
      {file.onServer && (keep || !takenFiles().has(file.fileId)) && (
        <Button size="sm" variant="ghost" className="mx-2 mb-2 mt-auto" asChild>
          <a
            href={`/api/files/${file.fileId}/content`}
            download={file.name}
            aria-label={t('archive.downloadNamed', { name: file.name })}
          >
            <DownloadIcon aria-hidden="true" />
            {t('convert.download')}
          </a>
        </Button>
      )}
    </div>
  );
}
