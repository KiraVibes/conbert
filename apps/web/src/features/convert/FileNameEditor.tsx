import { useRef, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { splitName, useFiles, type FileItem } from './files-store';

/**
 * The file name in a card. Click it to rename: only the part before the
 * extension is editable; results are named after it ("Urlaub.jpg" → "Urlaub.webp").
 */
export function FileNameEditor({ item }: { item: FileItem }) {
  const { t } = useTranslation();
  const rename = useFiles((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const { base, suffix } = splitName(item.name);

  const start = () => {
    setDraft(base);
    setEditing(true);
  };
  const finish = (save: boolean) => {
    if (save) rename(item.id, draft);
    setEditing(false);
    // Keep keyboard users where they were.
    requestAnimationFrame(() => button.current?.focus());
  };

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
          }}
          aria-label={t('files.renameLabel')}
          className="h-8 min-w-0 flex-1 font-medium"
          maxLength={200}
        />
        {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
      </div>
    );
  }

  return (
    <button
      ref={button}
      type="button"
      onClick={start}
      title={t('files.renameHint')}
      aria-label={t('files.renameNamed', { name: item.name })}
      className="group/name -mx-1 flex max-w-full items-center gap-1.5 rounded px-1 text-left font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="truncate">{item.name}</span>
      <PencilIcon
        className="size-3.5 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}
