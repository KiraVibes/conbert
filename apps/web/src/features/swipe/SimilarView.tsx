import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyIcon, Loader2Icon, ScanSearchIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  similarResponseSchema,
  similarScanSchema,
  type SimilarItem,
  type SimilarResponse,
} from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiRequestError, apiGet, apiPost } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';
import { useView } from '@/lib/use-view';
import { SourcePicker } from './SourcePicker';
import { cardUrl, sendSwipe, useMediaStatus, useSwipeSources } from './swipe-api';

type Level = 'strict' | 'normal' | 'loose';
const LEVELS: readonly Level[] = ['strict', 'normal', 'loose'];
const PAGE = 15;

const errorKey = (error: unknown) =>
  error instanceof ApiRequestError ? error.messageKey : 'errors.network';

/** Favourites and premium pictures are never suggested for deleting. */
const protectedItem = (item: SimilarItem) =>
  item.status === 'favorite' || item.status === 'premium';

/** The suggestion: keep the best (first) and every favourite, delete the rest. */
function suggestion(group: readonly SimilarItem[]): Set<string> {
  return new Set(
    group
      .slice(1)
      .filter((i) => !protectedItem(i))
      .map((i) => i.id),
  );
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

function Tile({
  item,
  best,
  marked,
  onToggle,
}: {
  item: SimilarItem;
  best: boolean;
  marked: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locked = protectedItem(item);
  const likeness = item.distance === 0 ? 'same' : item.distance <= 4 ? 'veryClose' : 'close';
  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-2 ${marked ? 'border-destructive/60 bg-destructive/5' : best ? 'border-primary' : ''}`}
      data-testid="similar-item"
    >
      <a
        href={cardUrl(item)}
        target="_blank"
        rel="noreferrer"
        className="flex aspect-square items-center justify-center overflow-hidden rounded bg-muted"
        title={t('similar.openFull')}
      >
        <img
          src={cardUrl(item)}
          alt={item.name}
          loading="lazy"
          className={`max-h-full max-w-full object-contain ${marked ? 'opacity-50' : ''}`}
        />
      </a>
      <div className="min-w-0 text-xs">
        <p className="truncate font-medium" title={item.path}>
          {item.name}
        </p>
        <p className="truncate text-muted-foreground" title={folderOf(item.path)}>
          {folderOf(item.path) || t('similar.topFolder')}
        </p>
        <p className="text-muted-foreground">
          {item.width && item.height ? `${item.width} × ${item.height} · ` : ''}
          {formatBytes(item.size, i18n.language)}
        </p>
        <p className={best ? 'font-medium text-primary' : 'text-muted-foreground'}>
          {best ? t('similar.best') : t(`similar.likeness.${likeness}`)}
        </p>
      </div>
      {locked ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <StarIcon className="size-3.5" aria-hidden="true" />
          {t('similar.favoriteStays')}
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-destructive"
            checked={marked}
            onChange={onToggle}
          />
          {t('similar.delete')}
        </label>
      )}
    </li>
  );
}

function Group({ group, onDone }: { group: SimilarItem[]; onDone: (deleted: number) => void }) {
  const { t } = useTranslation();
  const [marked, setMarked] = useState(() => suggestion(group));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const keepsNone = group.every((i) => marked.has(i.id));

  const apply = async () => {
    setBusy(true);
    try {
      for (const id of marked) await sendSwipe(id, 'delete');
      // Carried out right away (like "Done" on the swipe page).
      await apiPost('/api/swipe/flush', {});
      onDone(marked.size);
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-3" data-testid="similar-group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CopyIcon className="size-4" aria-hidden="true" />
          {t('similar.groupTitle', { count: group.length })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => onDone(0)} disabled={busy}>
            {t('similar.skip')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void apply()}
            disabled={busy || marked.size === 0 || keepsNone}
          >
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
            {t('similar.deleteMarked', { count: marked.size })}
          </Button>
        </div>
      </div>
      {keepsNone && <p className="text-sm text-destructive">{t('similar.keepOne')}</p>}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {group.map((item, i) => (
          <Tile
            key={item.id}
            item={item}
            best={i === 0}
            marked={marked.has(item.id)}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

/** "Similar pictures": groups of look-alikes on the storage location, keep the best. */
export function SimilarView() {
  const { t } = useTranslation();
  const [, navigate] = useView();
  const queryClient = useQueryClient();
  const status = useMediaStatus();
  const [level, setLevel] = useState<Level>('normal');
  const [folders, setFolders] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const ready = status.data?.problem === null && (status.data.items ?? 0) > 0;
  const sources = useSwipeSources('normal', true, ready);
  const key = ['similar', level, folders] as const;
  const similar = useQuery({
    queryKey: key,
    queryFn: () => {
      const params = new URLSearchParams({ level });
      if (folders.length > 0) params.set('folders', JSON.stringify(folders));
      return apiGet(`/api/media/similar?${params.toString()}`, similarResponseSchema);
    },
    enabled: ready,
    refetchInterval: (query) => (query.state.data?.scan.running ? 1500 : false),
  });
  const data: SimilarResponse | undefined = similar.data;
  const groups = useMemo(
    () => (data?.groups ?? []).filter((g) => !hidden.has(g[0]?.id ?? '')),
    [data, hidden],
  );

  const scan = async () => {
    try {
      await apiPost('/api/media/similar/scan', { folders }, similarScanSchema);
      await queryClient.invalidateQueries({ queryKey: ['similar'] });
    } catch (error) {
      toast.error(t(`${errorKey(error)}.what`));
    }
  };

  if (status.isPending) {
    return <Loader2Icon className="animate-spin" aria-label={t('swipe.loading')} />;
  }
  if (status.isError || !status.data) return <ErrorMessage messageKey={errorKey(status.error)} />;
  if (status.data.problem) {
    return (
      <ErrorMessage
        messageKey={`swipe.problems.${status.data.problem}`}
        actions={
          <Button size="sm" onClick={() => navigate('settings')}>
            {t('swipe.toSettings')}
          </Button>
        }
      />
    );
  }
  if (!ready) return <p className="text-sm text-muted-foreground">{t('similar.emptyIndex')}</p>;

  const running = data?.scan.running === true;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('similar.intro')} <HelpTip helpKey="similar.help" labelKey="similar.title" />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={level}
          onValueChange={(v) => {
            if (!v) return;
            setLevel(v as Level);
            setShown(PAGE);
          }}
          aria-label={t('similar.level')}
        >
          {LEVELS.map((l) => (
            <ToggleGroupItem key={l} value={l}>
              {t(`similar.levels.${l}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <HelpTip helpKey="similar.levelHelp" labelKey="similar.level" />
        <SourcePicker
          sources={sources.data?.sources ?? []}
          chosen={folders}
          onChange={(next) => {
            setFolders(next);
            setShown(PAGE);
          }}
        />
      </div>

      {data && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm" data-testid="similar-scan">
            {running
              ? t('similar.scanning', { done: data.scan.done, total: data.scan.total })
              : t('similar.hashed', { hashed: data.hashed, total: data.hashed + data.unhashed })}
            {!running &&
              data.scan.failed > 0 &&
              ` ${t('similar.failed', { count: data.scan.failed })}`}
          </p>
          {data.unhashed > 0 && !running && (
            <Button size="sm" onClick={() => void scan()}>
              <ScanSearchIcon aria-hidden="true" />
              {t('similar.scan', { count: data.unhashed })}
            </Button>
          )}
          {running && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
        </div>
      )}
      {data?.scan.error && <ErrorMessage messageKey={data.scan.error} />}

      {similar.isPending ? (
        <Loader2Icon className="animate-spin" aria-label={t('swipe.loading')} />
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {data && data.hashed === 0 ? t('similar.notScanned') : t('similar.none')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('similar.found', { count: groups.length })}
          </p>
          {groups.slice(0, shown).map((group) => (
            <Group
              key={group.map((i) => i.id).join()}
              group={group}
              onDone={(deleted) => {
                setHidden((h) => new Set(h).add(group[0]?.id ?? ''));
                if (deleted > 0) {
                  toast.success(t('similar.deleted', { count: deleted }));
                  void queryClient.invalidateQueries({ queryKey: ['similar'] });
                }
              }}
            />
          ))}
          {groups.length > shown && (
            <Button variant="outline" onClick={() => setShown((s) => s + PAGE)}>
              {t('similar.more', { count: groups.length - shown })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
