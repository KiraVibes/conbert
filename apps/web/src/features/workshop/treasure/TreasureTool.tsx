import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, FileUpIcon, PuzzleIcon, ScissorsIcon } from 'lucide-react';
import {
  MAX_SECRET_BYTES,
  MAX_SHARES,
  ShamirError,
  combineShares,
  findShares,
  parseShare,
  splitSecret,
  type Secret,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBytes } from '@/lib/format-bytes';
import { CopyButton } from '../CopyButton';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';

// The parts are plain ArrayBuffer-backed arrays, as getRandomValues wants.
const random = (bytes: Uint8Array) => {
  crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
  return bytes;
};

function errorText(
  t: (key: string, o?: Record<string, unknown>) => string,
  language: string,
  e: unknown,
): string {
  const code = e instanceof ShamirError ? e.code : 'unknown';
  return t(`workshop.treasure.errors.${code}`, {
    size: formatBytes(MAX_SECRET_BYTES, language),
    max: MAX_SHARES,
  });
}

const textFile = (text: string) => new Blob([text + '\n'], { type: 'text/plain' });

function Split() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [total, setTotal] = useState(5);
  const [needed, setNeeded] = useState(3);
  const [parts, setParts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tooBig = kind === 'file' && file !== null && file.size > MAX_SECRET_BYTES;
  const ready = kind === 'text' ? text.length > 0 : file !== null && !tooBig;

  const run = async () => {
    setError(null);
    setParts([]);
    try {
      const secret: Secret =
        kind === 'text' || !file
          ? { kind: 'text', text }
          : { kind: 'file', name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
      setParts(splitSecret(secret, total, needed, random));
    } catch (e) {
      setError(errorText(t, i18n.language, e));
    }
  };

  const saveAll = async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const files = Object.fromEntries(
      parts.map((p, i) => [
        t('workshop.treasure.partFile', { number: i + 1 }),
        strToU8(`${t('workshop.treasure.partNote', { needed })}\n\n${p}\n`),
      ]),
    );
    saveBlob(
      new Blob([zipSync(files)], { type: 'application/zip' }),
      t('workshop.treasure.zipName'),
    );
  };

  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={kind}
        onValueChange={(v) => v && setKind(v as 'text' | 'file')}
        aria-label={t('workshop.treasure.what')}
      >
        <ToggleGroupItem value="text">{t('workshop.treasure.kindText')}</ToggleGroupItem>
        <ToggleGroupItem value="file">{t('workshop.treasure.kindFile')}</ToggleGroupItem>
      </ToggleGroup>

      {kind === 'text' ? (
        <div className="space-y-1">
          <Label htmlFor="treasure-secret">{t('workshop.treasure.secret')}</Label>
          <textarea
            id="treasure-secret"
            className="min-h-24 w-full rounded-md border bg-transparent p-2 text-sm"
            placeholder={t('workshop.treasure.secretPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <SingleFile file={file} onFile={setFile} />
          <p className={tooBig ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
            {t('workshop.treasure.fileLimit', {
              size: formatBytes(MAX_SECRET_BYTES, i18n.language),
            })}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <Label htmlFor="treasure-total" className="flex items-center gap-1">
            {t('workshop.treasure.total')}
            <HelpTip helpKey="workshop.treasure.totalHelp" labelKey="workshop.treasure.total" />
          </Label>
          <Input
            id="treasure-total"
            type="number"
            className="w-24"
            min={2}
            max={MAX_SHARES}
            value={total}
            onChange={(e) => {
              const n = Math.max(2, Math.min(MAX_SHARES, Number(e.target.value) || 2));
              setTotal(n);
              setNeeded((k) => Math.min(k, n));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="treasure-needed" className="flex items-center gap-1">
            {t('workshop.treasure.needed')}
            <HelpTip
              helpKey="workshop.treasure.neededHelp"
              effectKey="workshop.treasure.neededEffect"
              labelKey="workshop.treasure.needed"
            />
          </Label>
          <Input
            id="treasure-needed"
            type="number"
            className="w-24"
            min={2}
            max={total}
            value={needed}
            onChange={(e) => setNeeded(Math.max(2, Math.min(total, Number(e.target.value) || 2)))}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('workshop.treasure.summary', { total, needed, lose: total - needed, leak: needed - 1 })}
      </p>

      <Button onClick={() => void run()} disabled={!ready}>
        <ScissorsIcon aria-hidden="true" />
        {t('workshop.treasure.split')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {parts.length > 0 && (
        <section className="space-y-3" aria-label={t('workshop.treasure.parts')}>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {t('workshop.treasure.handOut', { needed })}
          </p>
          <ol className="space-y-2">
            {parts.map((part, i) => (
              <li key={part} className="rounded-lg border p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium">
                    {t('workshop.treasure.partTitle', { number: i + 1, total })}
                  </span>
                  <CopyButton
                    text={part}
                    label={t('workshop.treasure.copyPart', { number: i + 1 })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('workshop.treasure.savePart', { number: i + 1 })}
                    title={t('workshop.treasure.savePart', { number: i + 1 })}
                    onClick={() =>
                      saveBlob(
                        textFile(`${t('workshop.treasure.partNote', { needed })}\n\n${part}`),
                        t('workshop.treasure.partFile', { number: i + 1 }),
                      )
                    }
                  >
                    <DownloadIcon aria-hidden="true" />
                  </Button>
                </div>
                <p className="max-h-24 overflow-auto font-mono text-xs break-all text-muted-foreground">
                  {part}
                </p>
              </li>
            ))}
          </ol>
          <Button variant="outline" onClick={() => void saveAll()}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.treasure.saveAll')}
          </Button>
        </section>
      )}
    </div>
  );
}

function Combine() {
  const { t, i18n } = useTranslation();
  const [pasted, setPasted] = useState('');
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<string | null>(null);

  const found = useMemo(() => {
    const shares = findShares(pasted);
    let needed = 0;
    for (const s of shares) {
      try {
        needed = parseShare(s).needed;
        break;
      } catch {
        // A damaged part: combining says so.
      }
    }
    return { shares, needed };
  }, [pasted]);

  const loadFiles = async (files: FileList | null) => {
    if (!files) return;
    const texts = await Promise.all([...files].map((f) => f.text()));
    setPasted((p) => [p, ...texts].filter(Boolean).join('\n'));
  };

  const run = () => {
    setError(null);
    setSecret(null);
    try {
      setSecret(combineShares(found.shares));
    } catch (e) {
      setError(errorText(t, i18n.language, e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="treasure-paste">{t('workshop.treasure.paste')}</Label>
        <textarea
          id="treasure-paste"
          className="min-h-32 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
          placeholder="conbert-teil:1:…"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {found.shares.length === 0
            ? t('workshop.treasure.noneFound')
            : t('workshop.treasure.found', {
                count: found.shares.length,
                needed: found.needed || '?',
              })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <label>
            <FileUpIcon aria-hidden="true" />
            {t('workshop.treasure.loadFiles')}
            <input
              type="file"
              multiple
              accept=".txt,text/plain"
              className="sr-only"
              onChange={(e) => {
                void loadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </Button>
        <Button onClick={run} disabled={found.shares.length === 0}>
          <PuzzleIcon aria-hidden="true" />
          {t('workshop.treasure.combine')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {secret?.kind === 'text' && (
        <section className="space-y-1 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 font-medium">{t('workshop.treasure.revealed')}</h3>
            <CopyButton text={secret.text} label={t('workshop.treasure.copySecret')} />
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{secret.text}</p>
        </section>
      )}
      {secret?.kind === 'file' && (
        <section className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <h3 className="font-medium">
            {t('workshop.treasure.revealedFile', { name: secret.name })}
          </h3>
          <Button
            onClick={() => saveBlob(new Blob([secret.data.slice()]), secret.name || 'schatz.bin')}
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.treasure.saveFile', { name: secret.name })}
          </Button>
        </section>
      )}
    </div>
  );
}

/** Schatzkarte: split a secret into parts, any K of which bring it back. */
export function TreasureTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="treasure" />
      <Tabs defaultValue="split" className="gap-4">
        <TabsList>
          <TabsTrigger value="split">{t('workshop.treasure.splitTab')}</TabsTrigger>
          <TabsTrigger value="combine">{t('workshop.treasure.combineTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="split" forceMount className="data-[state=inactive]:hidden">
          <Split />
        </TabsContent>
        <TabsContent value="combine" forceMount className="data-[state=inactive]:hidden">
          <Combine />
        </TabsContent>
      </Tabs>
    </div>
  );
}
