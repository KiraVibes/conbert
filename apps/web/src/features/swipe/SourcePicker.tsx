import { useTranslation } from 'react-i18next';
import { ChevronRightIcon, FolderTreeIcon } from 'lucide-react';
import type { SwipeSource } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Is a folder covered by the choice (itself or a folder above it is ticked)? */
function covered(path: string, chosen: readonly string[]): boolean {
  return chosen.some((c) => path === c || path.startsWith(`${c}/`));
}

function Node({
  node,
  chosen,
  onToggle,
}: {
  node: SwipeSource;
  chosen: string[];
  onToggle: (path: string) => void;
}) {
  const ticked = chosen.includes(node.path);
  const inherited = !ticked && covered(node.path, chosen);
  const box = (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={ticked || inherited}
        disabled={inherited}
        onChange={() => onToggle(node.path)}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{node.count}</span>
    </label>
  );
  if (node.children.length === 0) return <li className="pl-5">{box}</li>;
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            className="size-4 shrink-0 transition-transform [details[open]>summary>&]:rotate-90"
            aria-hidden="true"
          />
          {box}
        </summary>
        <ul className="ml-4 border-l pl-1">
          {node.children.map((child) => (
            <Node key={child.path} node={child} chosen={chosen} onToggle={onToggle} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** Which folders the cards come from: everything, a platform, a channel, a tag folder. */
export function SourcePicker({
  sources,
  chosen,
  onChange,
}: {
  sources: SwipeSource[];
  chosen: string[];
  onChange: (folders: string[]) => void;
}) {
  const { t } = useTranslation();
  const toggle = (path: string) =>
    onChange(
      chosen.includes(path)
        ? chosen.filter((c) => c !== path)
        : // A ticked folder covers its sub folders: those leave the list.
          [...chosen.filter((c) => !c.startsWith(`${path}/`)), path],
    );
  const label =
    chosen.length === 0
      ? t('swipe.sources.all')
      : chosen.length === 1
        ? chosen[0]
        : t('swipe.sources.some', { count: chosen.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="max-w-full justify-start">
          <FolderTreeIcon aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[60vh] w-80 overflow-auto" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('swipe.sources.title')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            disabled={chosen.length === 0}
          >
            {t('swipe.sources.all')}
          </Button>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('swipe.sources.empty')}</p>
        ) : (
          <ul>
            {sources.map((node) => (
              <Node key={node.path} node={node} chosen={chosen} onToggle={toggle} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
