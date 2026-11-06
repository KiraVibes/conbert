import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import {
  DOWNLOAD_QUALITIES,
  FEED_INTERVALS_MINUTES,
  MAX_DOWNLOAD_LIMIT,
  minFeedInterval,
  profilePartsFor,
  toolsFor,
  UGOIRA_FORMATS,
  type DownloadQuality,
  type PixivOptions,
  type ProfilePart,
  type UgoiraFormat,
} from '@conbert/core';
import type { FeedDto } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
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
import { useTargets } from '@/features/storage/storage-api';
import { AfterSelect } from '@/features/workflows/AfterSelect';
import { afterFromValue } from '@/features/workflows/after-actions';
import { ApiRequestError } from '@/lib/api';
import { FEEDS_KEY, feedBody, updateFeed } from './feeds-api';

/** The "Danach automatisch …" choice as the select shows it. */
function afterValue(after: FeedDto['after']): string {
  if (!after) return '';
  return 'workflowId' in after ? `wf:${after.workflowId}` : '';
}

/** Change a subscription: everything but the link itself. */
export function FeedEditor({ feed, onDone }: { feed: FeedDto; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const targets = (useTargets().data ?? []).filter((target) => target.usage.asTarget);
  const parts = profilePartsFor(feed.platform);
  const video = toolsFor(feed.platform)[0] === 'yt-dlp';
  const [name, setName] = useState(feed.name);
  const [interval, setIntervalMinutes] = useState(feed.intervalMinutes);
  const [quality, setQuality] = useState<DownloadQuality>(feed.quality);
  const [chosenParts, setChosenParts] = useState<ProfilePart[]>(feed.parts);
  const [pixiv, setPixiv] = useState<PixivOptions | null>(feed.pixiv);
  const [limit, setLimit] = useState(feed.limit);
  const [toList, setToList] = useState(feed.toList);
  const [targetIds, setTargetIds] = useState<string[]>(feed.targetIds);
  // A quick action can't be shown again in the select; it stays unless changed.
  const [after, setAfter] = useState(afterValue(feed.after));
  const [afterChanged, setAfterChanged] = useState(false);
  const [notify, setNotify] = useState(feed.notify);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const added = chosenParts.filter((p) => !feed.parts.includes(p));
  const noDestination = !toList && targetIds.length === 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateFeed(
        feed.id,
        feedBody(feed, {
          name,
          intervalMinutes: interval,
          quality,
          parts: chosenParts,
          pixiv,
          limit,
          toList,
          targetIds,
          after: afterChanged ? afterFromValue(after) : feed.after,
          notify,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: FEEDS_KEY });
      toast.success(t(added.length > 0 ? 'feeds.edit.savedCatchUp' : 'feeds.edit.saved'));
      onDone();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-4 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${feed.id}-name`}>{t('feeds.save.name')}</Label>
          <Input
            id={`${feed.id}-name`}
            value={name}
            maxLength={80}
            placeholder={feed.title ?? ''}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${feed.id}-interval`}>{t('feeds.interval')}</Label>
          <Select value={String(interval)} onValueChange={(v) => setIntervalMinutes(Number(v))}>
            <SelectTrigger id={`${feed.id}-interval`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEED_INTERVALS_MINUTES.filter((m) => m >= minFeedInterval(feed.platform)).map(
                (m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t(`feeds.intervals.${m}`)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {video && (
          <div className="space-y-1.5">
            <Label htmlFor={`${feed.id}-quality`}>{t('feeds.edit.quality')}</Label>
            <Select value={quality} onValueChange={(v) => setQuality(v as DownloadQuality)}>
              <SelectTrigger id={`${feed.id}-quality`} className="w-full">
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
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${feed.id}-limit`} className="flex items-center gap-1">
            {t('feeds.edit.limit')}
            <HelpTip helpKey="feeds.edit.limitHelp" labelKey="feeds.edit.limit" />
          </Label>
          <Input
            id={`${feed.id}-limit`}
            type="number"
            min={1}
            max={MAX_DOWNLOAD_LIMIT}
            value={limit}
            onChange={(e) =>
              setLimit(Math.max(1, Math.min(MAX_DOWNLOAD_LIMIT, Number(e.target.value) || 1)))
            }
          />
        </div>
      </div>

      {parts.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('feeds.edit.parts')}</legend>
          <div className="flex flex-wrap gap-4">
            {parts.map((part) => (
              <label key={part} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosenParts.includes(part)}
                  onChange={(e) =>
                    setChosenParts((p) =>
                      e.target.checked ? [...p, part] : p.filter((x) => x !== part),
                    )
                  }
                />
                {t(`downloader.parts.${part}`)}
              </label>
            ))}
          </div>
          {added.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('feeds.edit.catchUpHint')}</p>
          )}
        </fieldset>
      )}

      {pixiv && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`feed-ugoira-${feed.id}`} className="flex items-center gap-1.5">
              {t('downloader.pixiv.ugoira.label')}
              <HelpTip
                helpKey="downloader.pixiv.ugoira.help"
                labelKey="downloader.pixiv.ugoira.label"
              />
            </Label>
            <Select
              value={pixiv.ugoira}
              onValueChange={(v) => setPixiv({ ...pixiv, ugoira: v as UgoiraFormat })}
            >
              <SelectTrigger id={`feed-ugoira-${feed.id}`} className="w-full">
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
          </div>
          <div className="flex items-center gap-2 self-end">
            <Switch
              id={`feed-adult-${feed.id}`}
              checked={pixiv.adult}
              onCheckedChange={(adult) => setPixiv({ ...pixiv, adult })}
            />
            <Label htmlFor={`feed-adult-${feed.id}`} className="flex items-center gap-1.5">
              {t('downloader.pixiv.adult.label')}
              <HelpTip
                helpKey="downloader.pixiv.adult.help"
                labelKey="downloader.pixiv.adult.label"
              />
            </Label>
          </div>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('feeds.edit.destination')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={toList} onChange={(e) => setToList(e.target.checked)} />
          {t('downloader.destination.list')}
        </label>
        {targets.map((target) => (
          <label key={target.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={targetIds.includes(target.id)}
              onChange={(e) =>
                setTargetIds((ids) =>
                  e.target.checked ? [...ids, target.id] : ids.filter((x) => x !== target.id),
                )
              }
            />
            {t('downloader.destination.target', { name: target.name })}
          </label>
        ))}
        {noDestination && (
          <p className="text-xs text-destructive">{t('downloader.destination.none')}</p>
        )}
      </fieldset>

      <AfterSelect
        id={`${feed.id}-after`}
        value={after}
        onChange={(v) => {
          setAfter(v);
          setAfterChanged(true);
        }}
      />

      <div className="flex items-center gap-2">
        <Switch id={`${feed.id}-notify`} checked={notify} onCheckedChange={setNotify} />
        <Label htmlFor={`${feed.id}-notify`}>{t('feeds.save.notify')}</Label>
      </div>

      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void save()}
          disabled={saving || noDestination || (parts.length > 0 && chosenParts.length === 0)}
        >
          {saving && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {t('feeds.edit.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('feeds.save.cancel')}
        </Button>
      </div>
    </div>
  );
}
