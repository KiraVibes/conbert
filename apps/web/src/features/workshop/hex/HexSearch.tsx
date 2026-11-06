import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon } from 'lucide-react';
import { parseHexPattern } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { searchFile } from '../workshop-worker';

type Mode = 'text' | 'hex';

/** Search the file for text or bytes – forwards and backwards from the selected byte. */
export function HexSearch({
  file,
  selected,
  onFound,
}: {
  file: File;
  selected: number;
  onFound: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pattern = mode === 'hex' ? parseHexPattern(query) : new TextEncoder().encode(query);
  const invalid = query.trim() !== '' && (!pattern || pattern.length === 0);

  const run = async (backwards: boolean) => {
    if (!pattern || pattern.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const at = await searchFile(
        file,
        pattern,
        backwards ? selected - 1 : selected + 1,
        backwards,
      );
      if (at < 0) setMessage(t('workshop.hex.searchNone'));
      else onFound(at, at + pattern.length - 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(false);
      }}
    >
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor="hex-search">{t('workshop.hex.search')}</Label>
        <Input
          id="hex-search"
          className="font-mono"
          value={query}
          placeholder={mode === 'hex' ? '89 50 4E 47' : 'PNG'}
          aria-invalid={invalid || undefined}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={(v) => v && setMode(v as Mode)}
        aria-label={t('workshop.hex.searchMode')}
      >
        <ToggleGroupItem value="text">{t('workshop.hex.searchText')}</ToggleGroupItem>
        <ToggleGroupItem value="hex">{t('workshop.hex.searchHex')}</ToggleGroupItem>
      </ToggleGroup>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={busy || invalid || !query}
        aria-label={t('workshop.hex.searchPrevious')}
        onClick={() => void run(true)}
      >
        <ChevronUpIcon aria-hidden="true" />
      </Button>
      <Button
        type="submit"
        variant="outline"
        size="icon"
        disabled={busy || invalid || !query}
        aria-label={t('workshop.hex.searchNext')}
      >
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <ChevronDownIcon aria-hidden="true" />
        )}
      </Button>
      {invalid && (
        <p className="w-full text-sm text-destructive">{t('workshop.hex.searchInvalid')}</p>
      )}
      {message && (
        <p role="status" className="w-full text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}
