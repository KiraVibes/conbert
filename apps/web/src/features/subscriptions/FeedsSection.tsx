import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  RssIcon,
  Trash2Icon,
} from 'lucide-react';
import { FEED_INTERVALS_MINUTES, minFeedInterval } from '@conbert/core';
import type { FeedDto } from '@conbert/schemas';
import { FoldableSection } from '@/components/FoldableSection';
import { HelpTip } from '@/components/HelpTip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DOWNLOADS_KEY } from '@/features/downloader/downloader-api';
import { ApiRequestError } from '@/lib/api';
import { stamp } from '@/lib/stamp';
import { FeedEditor } from './FeedEditor';
import { FEEDS_KEY, checkFeed, deleteFeed, feedBody, updateFeed, useFeeds } from './feeds-api';

/** "in 5 Min." / "vor 2 Std." – relative times are easier to read than dates. */
function relative(iso: string | null, language: string): string {
  if (!iso) return '–';
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 48 * 60) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / 1440), 'day');
}

/** The subscribed profiles, channels and threads. */
export function FeedsSection({
  showEmpty = false,
  foldable = false,
}: {
  showEmpty?: boolean;
  /** Closed at first, opens on click (on busy pages like the downloader). */
  foldable?: boolean;
}) {
  const { t } = useTranslation();
  const feeds = useFeeds();
  if (!feeds.data || (feeds.data.length === 0 && !showEmpty)) return null;
  return (
    <FoldableSection
      id="feeds"
      title={t('feeds.title')}
      help={<HelpTip helpKey="feeds.help" labelKey="feeds.title" />}
      count={feeds.data.length}
      foldable={foldable}
    >
      {feeds.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('feeds.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {feeds.data.map((feed) => (
            <li key={feed.id}>
              <FeedRow feed={feed} />
            </li>
          ))}
        </ul>
      )}
    </FoldableSection>
  );
}

function FeedRow({ feed }: { feed: FeedDto }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const key = e instanceof ApiRequestError ? e.messageKey : 'errors.internal';
      toast.error(t(`${key}.what`));
    }
    await queryClient.invalidateQueries({ queryKey: FEEDS_KEY });
    await queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
  };
  const min = minFeedInterval(feed.platform);
  const title = feed.name || feed.title || feed.url;

  return (
    <Card className="gap-1.5 p-3" data-testid="feed">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <RssIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <Badge variant="secondary">{t(`downloader.platforms.${feed.platform}`)}</Badge>
        <p className="min-w-0 flex-1 truncate font-medium" title={feed.url}>
          {title}
        </p>
        <Select
          value={String(feed.intervalMinutes)}
          disabled={feed.ended}
          onValueChange={(v) =>
            void act(() => updateFeed(feed.id, feedBody(feed, { intervalMinutes: Number(v) })))
          }
        >
          <SelectTrigger className="h-8 w-auto" aria-label={t('feeds.interval')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FEED_INTERVALS_MINUTES.filter((m) => m >= min).map((m) => (
              <SelectItem key={m} value={String(m)}>
                {t(`feeds.intervals.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" asChild>
          <a href={feed.url} target="_blank" rel="noreferrer noopener" aria-label={t('feeds.open')}>
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={feed.ended || feed.checking}
          aria-label={t('feeds.checkNow')}
          onClick={() =>
            void act(async () => {
              const r = await checkFeed(feed.id);
              toast.message(
                t(r.started ? 'feeds.started' : r.waiting ? 'feeds.waitingStarted' : 'feeds.busy'),
              );
            })
          }
        >
          {feed.checking ? (
            <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <RefreshCwIcon aria-hidden="true" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('feeds.edit.open')}
          aria-pressed={editing}
          onClick={() => setEditing((v) => !v)}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        {!feed.ended && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t(feed.paused ? 'feeds.resume' : 'feeds.pause')}
            onClick={() =>
              void act(() => updateFeed(feed.id, feedBody(feed, { paused: !feed.paused })))
            }
          >
            {feed.paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
          </Button>
        )}
        {confirmDelete ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void act(() => deleteFeed(feed.id))}
          >
            {t('feeds.confirmRemove')}
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('feeds.remove')}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {feed.ended
          ? t('feeds.ended')
          : feed.checking
            ? t('feeds.checking')
            : feed.waiting
              ? t('feeds.waiting')
              : feed.paused
                ? t('feeds.paused')
                : t('feeds.next', { time: relative(feed.nextCheckAt, i18n.language) })}
        {feed.lastCheckAt &&
          ` · ${t('feeds.last', { time: stamp(feed.lastCheckAt, i18n.language), count: feed.lastNew })}`}
        {feed.lastFoundAt &&
          ` · ${t('feeds.lastFound', { time: stamp(feed.lastFoundAt, i18n.language) })}`}
        {feed.totalLoaded > 0 && ` · ${t('feeds.total', { count: feed.totalLoaded })}`}
      </p>
      {feed.lastError && <p className="text-xs text-destructive">{t(`${feed.lastError}.what`)}</p>}
      {editing && <FeedEditor feed={feed} onDone={() => setEditing(false)} />}
    </Card>
  );
}
