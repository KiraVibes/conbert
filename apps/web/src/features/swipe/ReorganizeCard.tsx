import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightIcon, FolderInputIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import {
  applyReorganize,
  MEDIA_STATUS_KEY,
  planReorganize,
  type ReorganizePlan,
} from './swipe-api';

/** Old download folders in the root → into their platform folder (after a look). */
export function ReorganizeCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<ReorganizePlan | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  /** Pixiv works with several pages: all of them or none (there can be thousands). */
  const [withPosts, setWithPosts] = useState(true);
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null);

  const load = async () => {
    setBusy('plan');
    try {
      setPlan(await planReorganize());
      setSkip(new Set());
      setWithPosts(true);
    } catch (error) {
      toast.error(
        t(`${error instanceof ApiRequestError ? error.messageKey : 'errors.network'}.what`),
      );
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy('apply');
    try {
      const result = await applyReorganize({
        moves: plan.moves.filter((m) => !skip.has(m.from)).map(({ from, to }) => ({ from, to })),
        leftovers: plan.leftovers.filter((l) => !skip.has(l)),
        posts: withPosts ? plan.posts.map(({ folder, id }) => ({ folder, id })) : [],
      });
      if (result.failed.length > 0) {
        toast.error(t('swipe.tidy.failed', { count: result.failed.length }), {
          description: result.failed.map((f) => f.path).join(', '),
        });
      } else {
        toast.success(
          [
            t('swipe.tidy.done', { moved: result.moved, deleted: result.deleted }),
            ...(result.posts > 0 ? [t('swipe.tidy.donePosts', { count: result.posts })] : []),
          ].join(' '),
        );
      }
      setPlan(null);
      await queryClient.invalidateQueries({ queryKey: MEDIA_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: ['swipe-sources'] });
    } catch (error) {
      toast.error(
        t(`${error instanceof ApiRequestError ? error.messageKey : 'errors.network'}.what`),
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: string) =>
    setSkip((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const nothing =
    plan && plan.moves.length === 0 && plan.leftovers.length === 0 && plan.posts.length === 0;
  const chosen = plan
    ? plan.moves.filter((m) => !skip.has(m.from)).length +
      plan.leftovers.filter((l) => !skip.has(l)).length +
      (withPosts ? plan.posts.length : 0)
    : 0;
  const firstPost = plan?.posts[0];

  return (
    <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{t('swipe.tidy.title')}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-muted-foreground">{t('swipe.tidy.intro')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy !== null}>
          {busy === 'plan' ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <FolderInputIcon aria-hidden="true" />
          )}
          {t('swipe.tidy.check')}
        </Button>
        {nothing && <p role="status">{t('swipe.tidy.nothing')}</p>}
        {plan && !nothing && (
          <div className="space-y-3">
            {plan.moves.length > 0 && (
              <ul className="divide-y rounded-md border">
                {plan.moves.map((m) => (
                  <li key={m.from}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={!skip.has(m.from)}
                        onChange={() => toggle(m.from)}
                      />
                      <span className="min-w-0 truncate font-mono text-xs">{m.from}</span>
                      <ArrowRightIcon className="size-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.to}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(`swipe.tidy.reasons.${m.reason}`)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {plan.leftovers.length > 0 && (
              <div className="space-y-1">
                <p>{t('swipe.tidy.leftovers')}</p>
                <ul className="divide-y rounded-md border">
                  {plan.leftovers.map((l) => (
                    <li key={l}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={!skip.has(l)}
                          onChange={() => toggle(l)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{l}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.posts.length > 0 && firstPost && (
              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-1.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={withPosts}
                    onChange={(e) => setWithPosts(e.target.checked)}
                  />
                  <span>
                    {t('swipe.tidy.posts', {
                      count: plan.posts.length,
                      pages: plan.posts.reduce((sum, p) => sum + p.pages, 0),
                      example: `${firstPost.folder ? `${firstPost.folder}/` : ''}${firstPost.id}/`,
                    })}
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">{t('swipe.tidy.postsHint')}</p>
              </div>
            )}
            {plan.unknown.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('swipe.tidy.unknown', { folders: plan.unknown.join(', ') })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('swipe.tidy.slowHint')}</p>
            <Button onClick={() => void apply()} disabled={busy !== null || chosen === 0}>
              {busy === 'apply' && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {t('swipe.tidy.apply', { count: chosen })}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
