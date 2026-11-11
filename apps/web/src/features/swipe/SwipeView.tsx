import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckIcon,
  CrownIcon,
  HeartIcon,
  Loader2Icon,
  RefreshCwIcon,
  StarIcon,
  Undo2Icon,
  UndoDotIcon,
  XIcon,
} from 'lucide-react';
import type { SwipeItem, SwipeMode, SwipeOutcome } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ViewIntro } from '@/components/ViewIntro';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettings } from '@/features/settings/settings-store';
import { usePrefersReducedMotion } from '@/features/settings/use-apply-settings';
import { ApiRequestError } from '@/lib/api';
import { useView } from '@/lib/use-view';
import { cn } from '@/lib/utils';
import { FullscreenViewer } from './FullscreenViewer';
import { exitBrowserFullscreen } from './zoom';
import { ReorganizeCard } from './ReorganizeCard';
import { SourcePicker } from './SourcePicker';
import { SwipeCard } from './SwipeCard';
import { countDone, doneList } from './tally';
import {
  MEDIA_STATUS_KEY,
  cardUrl,
  fetchNext,
  flushSwipes,
  sendSwipe,
  startSync,
  undoSwipe,
  useMediaStatus,
  useSwipeSources,
} from './swipe-api';
import { actionFor, keyToCommand, useSwipeGesture, type SwipeDirection } from './use-swipe';

const FOLDERS_KEY = (mode: SwipeMode) => `conbert-swipe-folders-${mode}`;

function loadFolders(mode: SwipeMode): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY(mode));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function saveFolders(mode: SwipeMode, folders: string[]): void {
  try {
    localStorage.setItem(FOLDERS_KEY(mode), JSON.stringify(folders));
  } catch {
    // Private window: the choice is just not remembered.
  }
}

const errorKey = (error: unknown) =>
  error instanceof ApiRequestError ? error.messageKey : 'errors.network';

/** Tinder for your downloads: delete, keep or favour – one card at a time. */
export function SwipeView() {
  const { t } = useTranslation();
  const [, navigate] = useView();
  const queryClient = useQueryClient();
  const status = useMediaStatus();
  const magic = useSettings((s) => s.magicEffects);
  const still = usePrefersReducedMotion();
  const [mode, setMode] = useState<SwipeMode>('normal');
  const [sorted, setSorted] = useState(false);
  const [folders, setFolders] = useState<string[]>(() => loadFolders('normal'));
  const [deck, setDeck] = useState<SwipeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [pending, setPending] = useState(0);
  /** What was really carried out on the storage location in this visit. */
  const [carried, setCarried] = useState<Record<string, number>>({});
  /** Full-screen swiping: the viewer always shows the top card. */
  const [fullscreen, setFullscreen] = useState(false);
  const fetching = useRef(false);
  const ready = status.data?.problem === null && (status.data.items ?? 0) > 0;
  const sources = useSwipeSources(mode, sorted, ready);

  // A new choice (mode, folders, sorted) starts a fresh pile.
  const generation = useRef(0);
  const newPile = () => {
    generation.current++;
    setDeck([]);
    setExhausted(false);
  };

  const refill = useCallback(async () => {
    if (fetching.current || !ready) return;
    fetching.current = true;
    setLoading(true);
    const gen = generation.current;
    try {
      const result = await fetchNext({ mode, folders, sorted, exclude: deck.map((d) => d.id) });
      if (gen !== generation.current) return;
      setPending(result.pending);
      setDeck((d) => [...d, ...result.items.filter((i) => !d.some((x) => x.id === i.id))]);
      setExhausted(result.items.length === 0);
      if (result.newRound) toast.info(t('swipe.newRound'));
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [ready, mode, folders, sorted, deck, t]);

  useEffect(() => {
    if (!ready || deck.length >= 3 || exhausted) return;
    const timer = window.setTimeout(() => void refill(), 0);
    return () => window.clearTimeout(timer);
  }, [ready, deck.length, exhausted, refill]);

  // The next pictures load while you look at this one.
  useEffect(() => {
    for (const item of deck.slice(1, 3)) {
      if (item.kind !== 'video') new Image().src = cardUrl(item);
    }
  }, [deck]);

  // Carried-out decisions change the counts (favourites, unsorted) and the folders.
  const refreshCounts = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: MEDIA_STATUS_KEY });
    await queryClient.invalidateQueries({ queryKey: ['swipe-sources'] });
  }, [queryClient]);

  const report = useCallback(
    (done: SwipeOutcome[]) => {
      if (done.length === 0) return;
      setCarried((c) => countDone(c, done));
      void refreshCounts();
      const failed = done.filter((d) => !d.ok);
      if (failed.length > 0) {
        toast.error(t('swipe.failed', { count: failed.length }), {
          description: failed
            .map(
              (f) =>
                `${f.name}: ${t(`errors.${f.error === 'STORAGE_NOT_FOUND' ? 'storageNotFound' : 'storageFailed'}.what`)}`,
            )
            .join('\n'),
        });
      }
    },
    [t, refreshCounts],
  );

  const decide = useCallback(
    (direction: SwipeDirection) => {
      const item = deck[0];
      if (!item) return;
      const action = actionFor(mode, direction);
      setDeck((d) => d.slice(1));
      void sendSwipe(item.id, action)
        .then((state) => {
          setPending(state.pending);
          report(state.done);
          // The favourites never run out: look again (a new round may start).
          if (mode === 'favorites') setExhausted(false);
        })
        .catch((error: unknown) => {
          toast.error(t(`${errorKey(error)}.what`));
          setDeck((d) => [item, ...d]);
        });
    },
    [deck, mode, report, t],
  );

  const openTop = useCallback(() => {
    if (deck[0]) setFullscreen(true);
  }, [deck]);
  const closeFullscreen = useCallback(() => {
    setFullscreen(false);
    exitBrowserFullscreen();
  }, []);
  const gesture = useSwipeGesture(decide, still, openTop);

  const undo = useCallback(async () => {
    try {
      const result = await undoSwipe();
      setPending(result.pending);
      const back = result.item;
      if (back) setDeck((d) => [back, ...d.filter((x) => x.id !== back.id)]);
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    }
  }, [t]);

  const finish = async () => {
    try {
      const state = await flushSwipes();
      setPending(0);
      report(state.done);
      // Only what this button did – earlier ones were carried out while swiping.
      const now = doneList(t, countDone({}, state.done));
      toast.success(now ? t('swipe.summary', { list: now }) : t('swipe.summaryNothing'));
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    }
  };

  // Keyboard: ← → ↑, Backspace / Ctrl+Z = back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
        return;
      const command = keyToCommand(e);
      if (!command) return;
      e.preventDefault();
      if (command === 'undo') void undo();
      else if (command === 'fullscreen') openTop();
      else if (deck[0]) gesture.fly(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deck, gesture, undo, openTop]);

  const sync = async () => {
    try {
      queryClient.setQueryData(MEDIA_STATUS_KEY, await startSync());
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    }
  };

  const changeMode = (next: SwipeMode) => {
    newPile();
    setMode(next);
    setFolders(loadFolders(next));
  };

  const s = status.data;
  const intro = (
    <ViewIntro title={t('swipe.title')} help="swipe">
      {t('swipe.intro')} <HelpTip helpKey="swipe.help" labelKey="swipe.title" />
    </ViewIntro>
  );

  if (status.isPending) {
    return (
      <div className="space-y-4">
        {intro}
        <Loader2Icon className="animate-spin" aria-label={t('swipe.loading')} />
      </div>
    );
  }
  if (status.isError || !s) {
    return (
      <div className="space-y-4">
        {intro}
        <ErrorMessage messageKey={errorKey(status.error)} />
      </div>
    );
  }
  if (s.problem) {
    return (
      <div className="space-y-4">
        {intro}
        <ErrorMessage
          messageKey={`swipe.problems.${s.problem}`}
          actions={
            <Button size="sm" onClick={() => navigate('settings')}>
              {t('swipe.toSettings')}
            </Button>
          }
        />
      </div>
    );
  }

  const top = deck[0];
  const icons =
    mode === 'favorites' ? [UndoDotIcon, CheckIcon, CrownIcon] : [XIcon, HeartIcon, StarIcon];
  const [LeftIcon, RightIcon, UpIcon] = icons as [typeof XIcon, typeof XIcon, typeof XIcon];

  /** The round buttons: below the cards and in the full-screen view. */
  const decisionButtons = (fly: (direction: SwipeDirection) => void, dark = false) => (
    <div className="flex items-center justify-center gap-3">
      <Button
        size="icon"
        variant="outline"
        className={cn(
          'size-14 rounded-full border-red-500/50 text-red-500 hover:bg-red-500/10',
          dark && 'bg-black/40',
        )}
        disabled={!top}
        onClick={() => fly('left')}
        aria-label={t(`swipe.buttons.${actionFor(mode, 'left')}`)}
        title={`${t(`swipe.buttons.${actionFor(mode, 'left')}`)} (←)`}
      >
        <LeftIcon className="size-6" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className={cn('size-11 rounded-full', dark && 'bg-black/40 text-white')}
        disabled={pending === 0}
        onClick={() => void undo()}
        aria-label={t('swipe.undo', { count: pending })}
        title={`${t('swipe.undo', { count: pending })} (Backspace)`}
      >
        <Undo2Icon aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className={cn(
          'size-14 rounded-full border-amber-400/60 text-amber-500 hover:bg-amber-400/10',
          dark && 'bg-black/40',
        )}
        disabled={!top || (mode === 'favorites' && top.status === 'premium')}
        onClick={() => fly('up')}
        aria-label={t(`swipe.buttons.${actionFor(mode, 'up')}`)}
        title={`${t(`swipe.buttons.${actionFor(mode, 'up')}`)} (↑)`}
      >
        <UpIcon className="size-6" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className={cn(
          'size-14 rounded-full border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10',
          dark && 'bg-black/40',
        )}
        disabled={!top}
        onClick={() => fly('right')}
        aria-label={t(`swipe.buttons.${actionFor(mode, 'right')}`)}
        title={`${t(`swipe.buttons.${actionFor(mode, 'right')}`)} (→)`}
      >
        <RightIcon className="size-6" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {intro}

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && changeMode(v as SwipeMode)}
          aria-label={t('swipe.mode')}
        >
          <ToggleGroupItem value="normal">{t('swipe.modes.normal')}</ToggleGroupItem>
          <ToggleGroupItem value="favorites">
            {t('swipe.modes.favorites', { count: s.favorites })}
          </ToggleGroupItem>
        </ToggleGroup>
        <SourcePicker
          sources={sources.data?.sources ?? []}
          chosen={folders}
          onChange={(next) => {
            newPile();
            setFolders(next);
            saveFolders(mode, next);
          }}
        />
        <div className="flex items-center gap-2">
          <Switch
            id="swipe-sorted"
            checked={sorted}
            onCheckedChange={(on) => {
              newPile();
              setSorted(on);
            }}
          />
          <Label htmlFor="swipe-sorted" className="flex items-center gap-1">
            {t('swipe.sorted')}
            <HelpTip helpKey="swipe.sortedHelp" labelKey="swipe.sorted" />
          </Label>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void sync()} disabled={s.syncing}>
          <RefreshCwIcon className={s.syncing ? 'animate-spin' : undefined} aria-hidden="true" />
          {s.syncing ? t('swipe.syncing', { count: s.progress?.seen ?? 0 }) : t('swipe.sync')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {s.lastSyncAt
          ? t('swipe.indexInfo', {
              target: s.target?.name ?? '',
              items: s.items,
              unsorted: s.unsorted,
              when: new Date(s.lastSyncAt).toLocaleString(),
            })
          : t('swipe.neverSynced', { target: s.target?.name ?? '' })}
        {s.syncError &&
          ` ${t(`errors.${s.syncError === 'STORAGE_NOT_FOUND' ? 'storageNotFound' : 'storageFailed'}.what`)}`}
      </p>

      {s.items === 0 && !s.syncing ? (
        <div className="space-y-3 rounded-lg border p-6 text-center">
          <p>{t('swipe.emptyIndex')}</p>
          <Button onClick={() => void sync()}>
            <RefreshCwIcon aria-hidden="true" />
            {t('swipe.syncNow')}
          </Button>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-md space-y-3">
          <div
            className="relative isolate h-[min(65vh,36rem)] w-full select-none"
            role="region"
            aria-label={t('swipe.deck')}
            aria-live="polite"
          >
            {deck
              .slice(0, 2)
              .reverse()
              .map((item) => (
                <SwipeCard
                  key={item.id}
                  item={item}
                  mode={mode}
                  active={item.id === top?.id}
                  shimmer={magic && !still}
                  {...(item.id === top?.id && {
                    drag: gesture.state,
                    hint: gesture.hint,
                    bind: gesture.bind,
                    onOpen: openTop,
                    paused: fullscreen,
                  })}
                />
              ))}
            {!top && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center">
                {loading ? (
                  <Loader2Icon className="animate-spin" aria-label={t('swipe.loading')} />
                ) : (
                  <>
                    <p className="text-lg font-medium">
                      {mode === 'favorites' ? t('swipe.doneFavorites') : t('swipe.allSorted')}
                    </p>
                    <p className="text-sm text-muted-foreground">{t('swipe.allSortedHint')}</p>
                  </>
                )}
              </div>
            )}
          </div>

          {decisionButtons(gesture.fly)}
          <p className="text-center text-xs text-muted-foreground">
            {t(mode === 'favorites' ? 'swipe.legendFavorites' : 'swipe.legend')}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            {pending > 0 ? t('swipe.undoHint', { count: pending }) : t('swipe.undoInfo')}
          </p>
          {Object.keys(carried).length > 0 && (
            <p className="text-center text-xs text-muted-foreground" data-testid="swipe-carried">
              {t('swipe.carried', { list: doneList(t, carried) })}
            </p>
          )}
          {pending > 0 && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => void finish()}>
                {t('swipe.finish')}
              </Button>
            </div>
          )}
        </div>
      )}

      <ReorganizeCard />
      <FullscreenViewer
        key={fullscreen ? (top?.id ?? 'empty') : 'closed'}
        open={fullscreen}
        item={fullscreen && top ? { ...top, url: cardUrl(top) } : null}
        onClose={closeFullscreen}
        swipe={{
          mode,
          onSwipe: decide,
          onUndo: () => void undo(),
          still,
          controls: (fly) => decisionButtons(fly, true),
          placeholder: loading ? (
            <Loader2Icon className="size-6 animate-spin" aria-label={t('swipe.loading')} />
          ) : (
            <>
              <p className="text-lg font-medium">
                {mode === 'favorites' ? t('swipe.doneFavorites') : t('swipe.allSorted')}
              </p>
              <p className="text-sm text-white/60">{t('swipe.allSortedHint')}</p>
            </>
          ),
        }}
      />
    </div>
  );
}
