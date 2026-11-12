import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellPlusIcon, Loader2Icon, RssIcon } from 'lucide-react';
import {
  FEED_INTERVALS_MINUTES,
  defaultFeedInterval,
  minFeedInterval,
  type DownloadQuality,
  type PixivOptions,
  type ProfilePart,
} from '@conbert/core';
import type { AfterDownload, ProbeDownloadResponse } from '@conbert/schemas';
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
import { ApiRequestError } from '@/lib/api';
import { useView } from '@/lib/use-view';
import { FEEDS_KEY, createFeed } from './feeds-api';

interface FeedChoices {
  quality: DownloadQuality;
  parts: ProfilePart[];
  /** Pixiv only. */
  pixiv?: PixivOptions;
  limit: number;
  sleepSeconds: number;
  toList: boolean;
  keepOnServer: boolean;
  after: AfterDownload;
  targetIds: string[];
}

/** "Als Abo speichern": the same choices as a download, checked again and again. */
export function SaveFeedPanel({
  probe,
  options,
  disabled,
  onSaved,
}: {
  probe: ProbeDownloadResponse;
  options: FeedChoices;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, navigate] = useView();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [interval, setIntervalMinutes] = useState<number>(defaultFeedInterval(probe.platform));
  const [onlyNew, setOnlyNew] = useState(true);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const min = minFeedInterval(probe.platform);

  if (!open) {
    return (
      <div className="border-t pt-4">
        <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
          <BellPlusIcon aria-hidden="true" />
          {t('feeds.save.open')}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">{t('feeds.save.teaser')}</p>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await createFeed({
        url: probe.url,
        probeId: probe.probeId,
        name,
        intervalMinutes: interval,
        onlyNew,
        notify,
        ...options,
      });
      await queryClient.invalidateQueries({ queryKey: FEEDS_KEY });
      toast.success(t('feeds.save.done'), {
        action: { label: t('feeds.save.show'), onClick: () => navigate('subscriptions') },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="space-y-3 border-t pt-4">
      <legend className="sr-only">{t('feeds.save.title')}</legend>
      <p className="flex items-center gap-1.5 font-medium">
        <RssIcon className="size-4 text-primary" aria-hidden="true" />
        {t('feeds.save.title')}
      </p>
      <p className="text-sm text-muted-foreground">{t('feeds.save.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="feed-name">{t('feeds.save.name')}</Label>
          <Input
            id="feed-name"
            value={name}
            maxLength={80}
            placeholder={probe.title ?? ''}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="feed-interval" className="flex items-center gap-1">
            {t('feeds.interval')}
            <HelpTip helpKey="feeds.intervalHelp" labelKey="feeds.interval" />
          </Label>
          <Select value={String(interval)} onValueChange={(v) => setIntervalMinutes(Number(v))}>
            <SelectTrigger id="feed-interval" className="w-full">
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
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Switch id="feed-only-new" checked={onlyNew} onCheckedChange={setOnlyNew} />
        <div className="space-y-0.5">
          <Label htmlFor="feed-only-new">{t('feeds.save.onlyNew')}</Label>
          <p className="text-xs text-muted-foreground">
            {onlyNew
              ? t('feeds.save.onlyNewOn')
              : t('feeds.save.onlyNewOff', { count: options.limit })}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Switch id="feed-notify" checked={notify} onCheckedChange={setNotify} />
        <div className="space-y-0.5">
          <Label htmlFor="feed-notify">{t('feeds.save.notify')}</Label>
          <p className="text-xs text-muted-foreground">{t('feeds.save.notifyHelp')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('feeds.save.sameChoices')}</p>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving || disabled}>
          {saving ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <BellPlusIcon aria-hidden="true" />
          )}
          {t('feeds.save.submit')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('feeds.save.cancel')}
        </Button>
      </div>
    </fieldset>
  );
}
