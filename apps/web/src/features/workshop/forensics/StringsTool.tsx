import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { STRING_KINDS, type StringKind } from '@conbert/core';
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
import { cn } from '@/lib/utils';
import { hex, saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useForensics } from './use-forensics';

const SHOWN = 500;
const LENGTHS = [4, 5, 8, 12];

/** Strings finder: readable text inside any file. */
export function StringsTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [minLength, setMinLength] = useState(5);
  const [kind, setKind] = useState<StringKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const { result, failed, busy } = useForensics(file, String(minLength), (api, f) =>
    api.strings(f, minLength),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (result?.strings ?? []).filter(
      (s) => (kind === 'all' || s.kinds.includes(kind)) && (!q || s.text.toLowerCase().includes(q)),
    );
  }, [result, kind, search]);

  function exportList() {
    const text = filtered.map((s) => `0x${hex(s.offset, 8)}\t${s.text}`).join('\n');
    saveBlob(
      new Blob([text], { type: 'text/plain' }),
      `${file?.name.replace(/\.[^.]+$/, '') ?? 'file'}-strings.txt`,
    );
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="strings" />
      <SingleFile file={file} onFile={setFile} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="strings-min">{t('workshop.strings.minLength')}</Label>
          <Select value={String(minLength)} onValueChange={(v) => setMinLength(Number(v))}>
            <SelectTrigger id="strings-min" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENGTHS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t('workshop.strings.letters', { count: n })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="strings-search">{t('workshop.strings.search')}</Label>
          <Input
            id="strings-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('workshop.strings.searchHint')}
          />
        </div>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.strings.failed')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {result && (
        <div className="space-y-3">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('workshop.strings.kinds')}
          >
            {(['all', ...STRING_KINDS] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs',
                  kind === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                {t(`workshop.strings.kind.${k}`)} (
                {(k === 'all' ? result.strings.length : result.counts[k]).toLocaleString(
                  i18n.language,
                )}
                )
              </button>
            ))}
          </div>
          {(result.truncated || result.partial) && (
            <p className="text-xs text-muted-foreground">{t('workshop.strings.truncated')}</p>
          )}
          <ul
            className="max-h-[60vh] overflow-auto rounded-lg border font-mono text-xs"
            data-testid="strings-list"
          >
            {filtered.slice(0, SHOWN).map((s) => (
              <li key={`${s.offset}-${s.encoding}`} className="flex gap-3 border-b px-2 py-1">
                <span className="shrink-0 text-muted-foreground">0x{hex(s.offset, 8)}</span>
                <span className="break-all">{s.text}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            {filtered.length > SHOWN && (
              <p className="text-sm text-muted-foreground">
                {t('workshop.strings.more', { count: filtered.length - SHOWN })}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={exportList}
              disabled={filtered.length === 0}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.strings.export', { count: filtered.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
