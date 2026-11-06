import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellRingIcon, PauseIcon, PlayIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { SUBSCRIPTION_INTERVALS_HOURS } from '@conbert/core';
import type { SubscriptionDto } from '@conbert/schemas';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiRequestError } from '@/lib/api';
import {
  BOORU_JOBS_KEY,
  SUBSCRIPTIONS_KEY,
  checkSubscription,
  deleteSubscription,
  updateSubscription,
  useSubscriptions,
} from './booru-api';

/** As the API wants it again (for changes). */
function subscriptionBody(sub: SubscriptionDto, patch: Partial<SubscriptionDto> = {}) {
  const s = { ...sub, ...patch };
  return {
    siteId: s.siteId,
    query: s.query,
    name: s.name,
    intervalHours: s.intervalHours,
    paused: s.paused,
    limit: s.limit,
    targetIds: s.targetIds,
    workflowId: s.workflowId,
    notify: s.notify,
  };
}

/** The saved tag searches that are checked regularly. */
export function SubscriptionsSection({ titleKey = 'booru.subs.title' }: { titleKey?: string }) {
  const { t } = useTranslation();
  const subscriptions = useSubscriptions();
  if (!subscriptions.data || subscriptions.data.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="booru-subs-title">
      <h2 id="booru-subs-title" className="flex items-center gap-1.5 text-lg font-semibold">
        {t(titleKey)}
        <HelpTip helpKey="booru.subs.help" labelKey={titleKey} />
      </h2>
      <ul className="space-y-2">
        {subscriptions.data.map((sub) => (
          <li key={sub.id}>
            <SubscriptionRow sub={sub} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubscriptionRow({ sub }: { sub: SubscriptionDto }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    await queryClient.invalidateQueries({ queryKey: BOORU_JOBS_KEY });
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const key = e instanceof ApiRequestError ? e.messageKey : 'errors.internal';
      toast.error(t(`${key}.what`));
    }
    await refresh();
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : '–');
  return (
    <Card className="gap-1.5 p-3" data-testid="booru-subscription">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <BellRingIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate font-medium" title={sub.query}>
          {sub.name || sub.query}
        </p>
        <Select
          value={String(sub.intervalHours)}
          onValueChange={(v) =>
            void act(() =>
              updateSubscription(sub.id, subscriptionBody(sub, { intervalHours: Number(v) })),
            )
          }
        >
          <SelectTrigger className="h-8 w-auto" aria-label={t('booru.subs.interval')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBSCRIPTION_INTERVALS_HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {t(`booru.subs.every.h${h}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('booru.subs.checkNow')}
          onClick={() =>
            void act(async () => {
              const r = await checkSubscription(sub.id);
              toast.message(t(r.started ? 'booru.subs.started' : 'booru.subs.busy'));
            })
          }
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t(sub.paused ? 'booru.subs.resume' : 'booru.subs.pause')}
          onClick={() =>
            void act(() =>
              updateSubscription(sub.id, subscriptionBody(sub, { paused: !sub.paused })),
            )
          }
        >
          {sub.paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('booru.subs.remove')}
          onClick={() => void act(() => deleteSubscription(sub.id))}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {sub.siteName} ·{' '}
        {sub.paused
          ? t('booru.subs.paused')
          : t('booru.subs.next', { time: when(sub.nextCheckAt) })}
        {sub.lastCheckAt &&
          ` · ${t('booru.subs.last', { time: when(sub.lastCheckAt), count: sub.lastNew })}`}
        {sub.totalLoaded > 0 && ` · ${t('booru.subs.total', { count: sub.totalLoaded })}`}
      </p>
      {sub.lastError && <p className="text-xs text-destructive">{t(`${sub.lastError}.what`)}</p>}
    </Card>
  );
}
