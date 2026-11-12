import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  BellPlusIcon,
  CheckIcon,
  DownloadIcon,
  EyeOffIcon,
  InfoIcon,
  ListPlusIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import {
  CRAWL_SPEEDS,
  FILE_PATTERN_PRESETS,
  FOLDER_PATTERN_PRESETS,
  MAX_POST_LIMIT,
  POST_LIMIT_HINT,
  SIDECAR_KINDS,
  renderPostName,
  type BooruPost,
  type CrawlSpeed,
  type SidecarKind,
} from '@conbert/core';
import type {
  BooruJobDto,
  BooruPostDto,
  BooruSearchResponse,
  BooruSettings,
  BooruSite,
} from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ClearListButton } from '@/components/ClearListButton';
import { TimeStamp } from '@/components/TimeStamp';
import { ViewIntro } from '@/components/ViewIntro';
import { cardTimeKey } from '@/lib/stamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { useTargets } from '@/features/storage/storage-api';
import { markTaken, takenFiles } from '@/features/downloader/downloader-api';
import { AfterSelect } from '@/features/workflows/AfterSelect';
import { afterFromValue } from '@/features/workflows/after-actions';
import { ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import {
  BOORU_JOBS_KEY,
  clearFinishedBooruJobs,
  SUBSCRIPTIONS_KEY,
  createSubscription,
  pauseBooruJob,
  removeBooruJob,
  resolvePostUrl,
  resumeBooruJob,
  searchBooru,
  startBooruJob,
  takeBooruFiles,
  useBooruJobs,
  useBooruSettings,
  useBooruSites,
} from './booru-api';
import { QueryForm } from './QueryForm';
import { SubscriptionsSection } from './SubscriptionsSection';
import { TagQueryInput } from './TagQueryInput';

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.internal', String(e));

const SITE_KEY = 'conbert-booru-site';
function rememberedSite(): string {
  try {
    return localStorage.getItem(SITE_KEY) ?? 'safebooru';
  } catch {
    return 'safebooru';
  }
}

interface Results {
  query: string;
  ids: number[] | null;
  posts: BooruPostDto[];
  last: BooruSearchResponse;
  hidden: BooruSearchResponse['hidden'];
  scanned: number;
}

/** Crawls that are over (a list entry that can go). */
const FINISHED: readonly string[] = ['done', 'error', 'cancelled'];

export function BooruView() {
  const { t } = useTranslation();
  const sites = useBooruSites();
  const settings = useBooruSettings();
  const [siteId, setSiteIdState] = useState(rememberedSite);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);

  const site = sites.data?.find((s) => s.id === siteId) ?? sites.data?.[0];
  const setSiteId = (id: string) => {
    setSiteIdState(id);
    setResults(null);
    try {
      localStorage.setItem(SITE_KEY, id);
    } catch {
      // Only a convenience.
    }
  };

  const take = useCallback(
    async (job: BooruJobDto, announce: boolean) => {
      try {
        const loaded = await takeBooruFiles(job.id);
        if (job.status === 'done') markTaken(`booru-job:${job.id}`);
        if (loaded.length === 0) return;
        await addFiles(loaded, defaultMode, 'convert');
        if (announce) toast.success(t('downloader.added', { count: loaded.length }));
      } catch {
        toast.error(t('downloader.gone'));
      }
    },
    [addFiles, defaultMode, t],
  );
  const onUpdate = useCallback(
    (job: BooruJobDto) => {
      if (job.toList && job.status === 'done' && job.downloaded > 0) void take(job, true);
    },
    [take],
  );
  const jobs = useBooruJobs(onUpdate);
  const queryClient = useQueryClient();
  const clearList = async () => {
    try {
      await clearFinishedBooruJobs();
    } catch (e) {
      toast.error(t(`${asError(e).messageKey}.what`));
    }
    await queryClient.invalidateQueries({ queryKey: BOORU_JOBS_KEY });
  };

  const run = async (more: boolean) => {
    if (!site) return;
    setBusy(true);
    setError(null);
    try {
      let ids: number[] | null = more ? (results?.ids ?? null) : null;
      let siteForSearch = site.id;
      const text = more ? (results?.query ?? '') : query.trim();
      // A link to a single post instead of a search.
      if (!more && /^https?:\/\//i.test(text)) {
        const found = await resolvePostUrl(text);
        siteForSearch = found.siteId;
        if (found.siteId !== site.id) setSiteId(found.siteId);
        ids = [found.postId];
      }
      const next = more ? results?.last.next : null;
      const response = await searchBooru(siteForSearch, {
        ...(ids ? { ids } : { query: text }),
        ...(next?.before !== undefined && { before: next.before }),
        ...(next?.page !== undefined && { page: next.page }),
        limit: 60,
      });
      setResults((old) => {
        const base = more && old ? old : null;
        const hidden = { ...response.hidden };
        if (base)
          for (const k of Object.keys(hidden) as (keyof typeof hidden)[])
            hidden[k] += base.hidden[k];
        return {
          query: ids ? '' : text,
          ids,
          posts: [...(base?.posts ?? []), ...response.posts],
          last: response,
          hidden,
          scanned: (base?.scanned ?? 0) + response.scanned,
        };
      });
      if (!more) setSelected(new Set(response.posts.filter((p) => !p.known).map((p) => p.id)));
      else
        setSelected(
          (s) => new Set([...s, ...response.posts.filter((p) => !p.known).map((p) => p.id)]),
        );
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <ViewIntro title={t('booru.title')} help="booru">
        {t('booru.intro')}
      </ViewIntro>
      {settings.data && !settings.data.ageConfirmed && (
        <p className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{t('booru.onlyGeneralHint')}</span>
        </p>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="sm:w-48">
            <Label htmlFor="booru-site" className="sr-only">
              {t('booru.site')}
            </Label>
            <Select value={site?.id ?? ''} onValueChange={setSiteId}>
              <SelectTrigger id="booru-site" className="w-full">
                <SelectValue placeholder={t('booru.site')} />
              </SelectTrigger>
              <SelectContent>
                {sites.data?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {site && (
            <TagQueryInput
              id="booru-query"
              siteId={site.id}
              value={query}
              onChange={setQuery}
              onSubmit={() => void run(false)}
              placeholder={t('booru.search.placeholder')}
            />
          )}
          <Button onClick={() => void run(false)} disabled={busy || !site}>
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <SearchIcon aria-hidden="true" />
            )}
            {t('booru.search.button')}
          </Button>
        </div>
        {site && <SiteInfo site={site} />}
        <div className="flex items-center gap-2">
          <Switch id="booru-form" checked={showForm} onCheckedChange={setShowForm} />
          <Label htmlFor="booru-form">{t('booru.form.toggle')}</Label>
          <HelpTip helpKey="booru.form.toggleHelp" labelKey="booru.form.toggle" />
        </div>
        {showForm && site && <QueryForm siteId={site.id} query={query} onChange={setQuery} />}
      </div>

      {error && (
        <ErrorMessage
          messageKey={error.messageKey}
          details={error.details}
          actions={
            error.code === 'BOORU_NEEDS_ACCOUNT' || error.code === 'BOORU_AUTH' ? (
              <Button size="sm" variant="outline" asChild>
                <a href="#/settings">{t('downloader.toSettings')}</a>
              </Button>
            ) : undefined
          }
        />
      )}

      {results && site && (
        <ResultsSection
          results={results}
          selected={selected}
          setSelected={setSelected}
          busy={busy}
          onMore={() => void run(true)}
        />
      )}
      {results && site && settings.data && (results.posts.length > 0 || results.ids === null) && (
        <DownloadPanel
          key={`${site.id}:${results.query}`}
          site={site}
          settings={settings.data}
          results={results}
          selected={selected}
        />
      )}

      <SubscriptionsSection foldable />

      <section className="space-y-3" aria-labelledby="booru-jobs-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="booru-jobs-title" className="text-lg font-semibold">
            {t('booru.jobs.title')}
          </h2>
          <ClearListButton
            count={jobs.data?.filter((j) => FINISHED.includes(j.status)).length ?? 0}
            textKey="clearList.booru"
            onConfirm={clearList}
          />
        </div>
        {jobs.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('booru.jobs.empty')}</p>
        )}
        <ul className="space-y-3">
          {jobs.data?.map((job) => (
            <li key={job.id}>
              <JobRow job={job} onTake={() => void take(job, true)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SiteInfo({ site }: { site: BooruSite }) {
  const { t } = useTranslation();
  const help = site.custom ? t(`booru.api.${site.api}`) : t(`booru.siteHelp.${site.id}`);
  return (
    <p className="text-xs text-muted-foreground">
      {help} {t('booru.tagLimit', { count: site.tagLimit })}
      {site.needsAccount && !site.account && (
        <>
          {' '}
          <a className="text-primary underline" href="#/settings">
            {t('booru.needsAccountLink')}
          </a>
        </>
      )}
    </p>
  );
}

function ResultsSection({
  results,
  selected,
  setSelected,
  busy,
  onMore,
}: {
  results: Results;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  busy: boolean;
  onMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { posts, hidden, last } = results;
  const hiddenTotal = Object.values(hidden).reduce((a, b) => a + b, 0);
  const chosen = posts.filter((p) => selected.has(p.id));
  const knownSize = chosen.every((p) => p.size !== null);
  const size = chosen.reduce((sum, p) => sum + (p.size ?? 0), 0);
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  return (
    <section className="space-y-3" aria-labelledby="booru-results-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="booru-results-title" className="text-lg font-semibold">
          {t('booru.results.title', { count: posts.length })}
        </h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(posts.filter((p) => !p.known).map((p) => p.id)))}
          >
            {t('booru.results.selectAll')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            {t('booru.results.selectNone')}
          </Button>
        </div>
      </div>
      {last.plan.localOnly.length > 0 && (
        <p className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {t('booru.results.localOnly', {
            count: last.plan.tagLimit,
            tags: last.plan.localOnly.join(' '),
          })}
          {last.plan.estimate !== null &&
            ` ${t('booru.results.estimate', { count: last.plan.estimate })}`}
        </p>
      )}
      {hiddenTotal > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <EyeOffIcon className="size-4 shrink-0" aria-hidden="true" />
          {t('booru.results.hidden', { count: hiddenTotal })}{' '}
          {(['protected', 'rating', 'blacklist', 'filter', 'unavailable'] as const)
            .filter((k) => hidden[k] > 0)
            .map((k) => t(`booru.hidden.${k}`, { count: hidden[k] }))
            .join(' · ')}
        </p>
      )}
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('booru.results.none')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {posts.map((post) => (
            <li key={post.id}>
              <PostTile
                post={post}
                checked={selected.has(post.id)}
                onToggle={() => toggle(post.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {t('booru.results.selected', { count: chosen.length })}
          {chosen.length > 0 &&
            ` · ${
              knownSize
                ? formatBytes(size, i18n.language)
                : size > 0
                  ? t('booru.results.sizeAtLeast', { size: formatBytes(size, i18n.language) })
                  : t('booru.results.sizeUnknown')
            }`}
        </span>
        {last.next && (
          <Button size="sm" variant="outline" onClick={onMore} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            {t('booru.results.more')}
          </Button>
        )}
      </div>
      {last.pageLimitReached && (
        <p className="text-sm text-amber-800 dark:text-amber-300">{t('booru.results.pageLimit')}</p>
      )}
    </section>
  );
}

function PostTile({
  post,
  checked,
  onToggle,
}: {
  post: BooruPostDto;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      className={`relative block cursor-pointer overflow-hidden rounded-md border-2 ${checked ? 'border-primary' : 'border-transparent'}`}
      title={post.tags.slice(0, 15).join(' ')}
    >
      <input
        type="checkbox"
        className="absolute top-1.5 left-1.5 z-10 size-4"
        checked={checked}
        onChange={onToggle}
        aria-label={t('booru.results.choose', { id: post.id })}
      />
      <div className="flex aspect-square items-center justify-center bg-muted">
        {post.thumb ? (
          <img
            src={`/api/booru/thumbs/${post.thumb}`}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{post.ext}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-xs">
        <span className="truncate text-muted-foreground">
          {post.width && post.height ? `${post.width}×${post.height}` : `#${post.id}`}
        </span>
        {post.known && (
          <Badge variant="secondary" className="px-1 text-[10px]">
            {t('booru.results.known')}
          </Badge>
        )}
      </div>
    </label>
  );
}

const EXAMPLE_POST: BooruPost = {
  id: 1234567,
  md5: 'd41d8cd98f00b204e9800998ecf8427e',
  rating: 'general',
  tags: ['1girl', 'cat_ears'],
  artists: ['some_artist'],
  characters: ['hero'],
  copyrights: ['series'],
  score: 42,
  favorites: 1,
  width: 1920,
  height: 1080,
  ext: 'png',
  size: 1,
  createdAt: '2026-01-31T00:00:00.000Z',
  fileUrl: null,
  sampleUrl: null,
  previewUrl: null,
  source: null,
  postUrl: '',
};

function DownloadPanel({
  site,
  settings,
  results,
  selected,
}: {
  site: BooruSite;
  settings: BooruSettings;
  results: Results;
  selected: Set<number>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const targets = useTargets().data?.filter((x) => x.usage.asTarget) ?? [];
  const defaultTarget = targets.find((x) => x.isDefault);
  const whole = results.ids === null;
  const [scope, setScope] = useState<'selected' | 'all'>(
    selected.size > 0 || !whole ? 'selected' : 'all',
  );
  const [limit, setLimit] = useState(100);
  const [speed, setSpeed] = useState<CrawlSpeed>(
    site.tagLimit < 3 && results.last.plan.localOnly.length > 0 ? 'slow' : 'normal',
  );
  const [night, setNight] = useState(false);
  const [after, setAfter] = useState('');
  const [toList, setToList] = useState(!defaultTarget);
  const [chosenTargets, setChosenTargets] = useState<string[] | null>(null);
  const targetIds = chosenTargets ?? (defaultTarget ? [defaultTarget.id] : []);
  const [filePattern, setFilePattern] = useState(settings.filePattern);
  const [folderPattern, setFolderPattern] = useState(settings.folderPattern);
  const [sidecars, setSidecars] = useState<SidecarKind[]>(settings.sidecars);
  const [sample, setSample] = useState(settings.sample);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const example = useMemo(
    () =>
      renderPostName(filePattern, folderPattern, EXAMPLE_POST, {
        site: site.custom ? site.name : site.id,
        searchTags: results.query,
      }),
    [filePattern, folderPattern, site, results.query],
  );
  const noDestination = !toList && targetIds.length === 0;
  const count = scope === 'selected' ? selected.size : limit;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await startBooruJob(site.id, {
        query: results.query,
        ...(scope === 'selected' && { postIds: [...selected] }),
        limit: scope === 'selected' ? Math.max(1, selected.size) : limit,
        speed,
        window: night ? { fromHour: 1, toHour: 7 } : null,
        filePattern,
        folderPattern,
        sidecars,
        sample,
        targetIds,
        toList,
        after: afterFromValue(after),
      });
      toast.success(t('booru.download.started'));
      await queryClient.invalidateQueries({ queryKey: BOORU_JOBS_KEY });
    } catch (e) {
      setError(asError(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className="gap-4 p-4">
      <h2 className="text-lg font-semibold">{t('booru.download.title')}</h2>
      {whole && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">{t('booru.download.scope')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="size-4"
              checked={scope === 'selected'}
              onChange={() => setScope('selected')}
            />
            {t('booru.download.selected', { count: selected.size })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="size-4"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            {t('booru.download.all')}
          </label>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {scope === 'all' && (
          <div className="space-y-1.5">
            <Label htmlFor="booru-limit" className="flex items-center gap-1.5">
              {t('booru.download.limit')}
              <HelpTip helpKey="booru.download.limitHelp" labelKey="booru.download.limit" />
            </Label>
            <Input
              id="booru-limit"
              type="number"
              min={1}
              max={MAX_POST_LIMIT}
              value={limit}
              onChange={(e) =>
                setLimit(
                  Math.min(MAX_POST_LIMIT, Math.max(1, Math.round(Number(e.target.value) || 1))),
                )
              }
            />
            {limit >= POST_LIMIT_HINT && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {t('booru.download.limitMany')}
              </p>
            )}
          </div>
        )}
        {scope === 'all' && (
          <div className="space-y-1.5">
            <Label htmlFor="booru-speed" className="flex items-center gap-1.5">
              {t('booru.download.speed')}
              <HelpTip helpKey="booru.download.speedHelp" labelKey="booru.download.speed" />
            </Label>
            <Select value={speed} onValueChange={(v) => setSpeed(v as CrawlSpeed)}>
              <SelectTrigger id="booru-speed" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRAWL_SPEEDS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`booru.speed.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t(`booru.speed.${speed}Help`)}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={night}
                onChange={(e) => setNight(e.target.checked)}
              />
              {t('booru.download.night')}
              <HelpTip helpKey="booru.download.nightHelp" labelKey="booru.download.night" />
            </label>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="booru-file-pattern" className="flex items-center gap-1.5">
            {t('booru.naming.file')}
            <HelpTip helpKey="booru.naming.help" labelKey="booru.naming.file" />
          </Label>
          <Input
            id="booru-file-pattern"
            list="booru-file-presets"
            value={filePattern}
            onChange={(e) => setFilePattern(e.target.value)}
          />
          <datalist id="booru-file-presets">
            {FILE_PATTERN_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booru-folder-pattern">{t('booru.naming.folder')}</Label>
          <Input
            id="booru-folder-pattern"
            list="booru-folder-presets"
            value={folderPattern}
            onChange={(e) => setFolderPattern(e.target.value)}
          />
          <datalist id="booru-folder-presets">
            {FOLDER_PATTERN_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t('booru.naming.example')}{' '}
          <code className="break-all">
            {example.folder ? `${example.folder}/` : ''}
            {example.name}
          </code>
        </p>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          {t('booru.sidecar.label')}
          <HelpTip helpKey="booru.sidecar.help" labelKey="booru.sidecar.label" />
        </legend>
        <div className="flex flex-wrap gap-3">
          {SIDECAR_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={sidecars.includes(kind)}
                onChange={() =>
                  setSidecars((s) =>
                    s.includes(kind) ? s.filter((x) => x !== kind) : [...s, kind],
                  )
                }
              />
              {t(`booru.sidecar.${kind}`)}
              <HelpTip helpKey={`booru.sidecar.${kind}Help`} labelKey={`booru.sidecar.${kind}`} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={sample}
              onChange={(e) => setSample(e.target.checked)}
            />
            {t('booru.download.sample')}
            <HelpTip helpKey="booru.download.sampleHelp" labelKey="booru.download.sample" />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          {t('downloader.destination.label')}
          <HelpTip
            helpKey="booru.download.destinationHelp"
            labelKey="downloader.destination.label"
          />
        </legend>
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
        {sidecars.some((s) => s !== 'embed') && targetIds.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('booru.sidecar.onlyTargets')}</p>
        )}
        {noDestination && (
          <p className="text-xs text-destructive">{t('downloader.destination.none')}</p>
        )}
      </fieldset>
      <AfterSelect id="after-select" value={after} onChange={setAfter} />
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void start()} disabled={starting || noDestination || count === 0}>
          {starting ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          {scope === 'selected'
            ? t('booru.download.startSelected', { count })
            : t('booru.download.start', { count })}
        </Button>
        {whole && results.query.trim() !== '' && (
          <Button
            variant="outline"
            disabled={noDestination}
            onClick={() =>
              void createSubscription({
                siteId: site.id,
                query: results.query,
                limit,
                targetIds,
                intervalHours: 24,
              })
                .then(() => {
                  toast.success(t('booru.subs.created'));
                  return queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
                })
                .catch((e: unknown) => setError(asError(e)))
            }
          >
            <BellPlusIcon aria-hidden="true" />
            {t('booru.subs.save')}
          </Button>
        )}
        <HelpTip helpKey="booru.subs.help" labelKey="booru.subs.save" />
      </div>
    </Card>
  );
}

function duration(seconds: number, t: (key: string, o?: Record<string, unknown>) => string) {
  if (seconds < 90) return t('booru.eta.minute');
  if (seconds < 90 * 60) return t('booru.eta.minutes', { count: Math.round(seconds / 60) });
  if (seconds < 36 * 3600) return t('booru.eta.hours', { count: Math.round(seconds / 3600) });
  return t('booru.eta.days', { count: Math.round(seconds / 86400) });
}

function JobRow({ job, onTake }: { job: BooruJobDto; onTake: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const number = new Intl.NumberFormat(i18n.language);
  const active = job.status === 'queued' || job.status === 'running' || job.status === 'waiting';
  const refresh = () => queryClient.invalidateQueries({ queryKey: BOORU_JOBS_KEY });
  const act = async (fn: () => Promise<unknown>) => {
    await fn().catch((e: unknown) => toast.error(t(`${asError(e).messageKey}.what`)));
    await refresh();
  };
  const progress = job.limit > 0 ? Math.min(100, Math.round((job.matched / job.limit) * 100)) : 0;
  return (
    <Card className="gap-2 p-3" data-testid="booru-job">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={job.query}>
            {job.query || t('booru.jobs.selection')}
          </p>
          <p className="text-xs text-muted-foreground">
            {job.siteName} · {t(`booru.jobs.status.${job.status}`)}
            {job.status === 'waiting' &&
              job.resumeAt &&
              ` ${t('booru.jobs.until', { time: new Date(job.resumeAt).toLocaleString(i18n.language) })}`}
          </p>
          <TimeStamp
            labelKey={cardTimeKey(job.status, !!job.subscriptionId)}
            iso={job.finishedAt ?? job.createdAt}
          />
        </div>
        {(job.status === 'running' || job.status === 'queued' || job.status === 'waiting') && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void act(() => pauseBooruJob(job.id))}
            aria-label={t('booru.jobs.pause')}
          >
            <PauseIcon aria-hidden="true" />
          </Button>
        )}
        {job.status === 'paused' && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void act(() => resumeBooruJob(job.id))}
            aria-label={t('booru.jobs.resume')}
          >
            <PlayIcon aria-hidden="true" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void act(() => removeBooruJob(job.id))}
          aria-label={
            active || job.status === 'paused' ? t('booru.jobs.cancel') : t('booru.jobs.remove')
          }
        >
          {active || job.status === 'paused' ? (
            <XIcon aria-hidden="true" />
          ) : (
            <Trash2Icon aria-hidden="true" />
          )}
        </Button>
      </div>
      {(active || job.status === 'paused') && (
        <Progress value={progress} aria-label={t(`booru.jobs.status.${job.status}`)} />
      )}
      <p className="text-sm text-muted-foreground tabular-nums">
        {t('booru.jobs.counts', {
          scanned: number.format(job.scanned),
          matched: number.format(job.matched),
          downloaded: number.format(job.downloaded),
        })}
        {job.duplicates > 0 && ` · ${t('booru.jobs.duplicates', { count: job.duplicates })}`}
        {job.failed > 0 && ` · ${t('booru.jobs.failed', { count: job.failed })}`}
        {job.etaSeconds !== null &&
          ` – ${t('booru.jobs.eta', { time: duration(job.etaSeconds, t) })}`}
      </p>
      {job.savedTo.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
          <CheckIcon className="size-3" aria-hidden="true" />
          {t('booru.jobs.savedTo', { names: job.savedTo.join(', ') })}
        </p>
      )}
      {job.recent.length > 0 && (
        <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" aria-label={t('booru.jobs.recent')}>
          {job.recent.slice(0, 16).map((file) => (
            <li
              key={file.postId}
              className="aspect-square overflow-hidden rounded bg-muted"
              title={file.name}
            >
              {file.thumb && (
                <img
                  src={`/api/booru/thumbs/${file.thumb}`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {job.toList &&
        job.status !== 'running' &&
        job.downloaded > 0 &&
        !takenFiles().has(`booru-job:${job.id}`) && (
          <div>
            <Button size="sm" variant="outline" onClick={onTake}>
              <ListPlusIcon aria-hidden="true" />
              {t('downloader.addToList')}
            </Button>
          </div>
        )}
      {job.error &&
        (job.status === 'error' ||
          job.status === 'paused' ||
          job.status === 'waiting' ||
          job.status === 'done') && (
          <ErrorMessage messageKey={job.error.messageKey} details={job.error.details} />
        )}
    </Card>
  );
}
