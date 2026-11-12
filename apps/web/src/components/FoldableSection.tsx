import { useState, type ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * A section with a heading. When `foldable`, the heading is a button that opens
 * and closes the content (closed at first), with the number of entries beside it.
 */
export function FoldableSection({
  id,
  title,
  help,
  count,
  foldable,
  children,
}: {
  id: string;
  title: string;
  help?: ReactNode;
  count: number;
  foldable: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = !foldable || open;
  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="flex items-center gap-1.5 text-lg font-semibold">
        {foldable ? (
          <button
            type="button"
            className="-ml-1 flex items-center gap-1.5 rounded-md px-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-expanded={open}
            aria-controls={`${id}-content`}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRightIcon
              className={cn(
                'size-4 transition-transform motion-reduce:transition-none',
                open && 'rotate-90',
              )}
              aria-hidden="true"
            />
            {title}
            <Badge variant="secondary">{count}</Badge>
          </button>
        ) : (
          title
        )}
        {help}
      </h2>
      {shown && <div id={`${id}-content`}>{children}</div>}
    </section>
  );
}
