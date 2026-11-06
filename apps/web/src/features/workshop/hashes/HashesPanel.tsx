import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  Loader2Icon,
} from 'lucide-react';
import {
  HASH_ALGORITHMS,
  HASH_LABELS,
  checksumFile,
  compareHash,
  type HashAlgorithm,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { saveBlob } from '../save-blob';
import { computeHashes, type HashJob } from '../workshop-worker';

/** Files up to this size are checked right away; bigger ones on request. */
const AUTO_START_BYTES = 256 * 1024 * 1024;

type Results = Partial<Record<HashAlgorithm, string>>;

/** MD5 … BLAKE3 in one pass, plus "does my checksum fit?". */
export function HashesPanel({ file }: { file: File }) {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useState<Set<HashAlgorithm>>(() => new Set(HASH_ALGORITHMS));
  const [results, setResults] = useState<Results>({});
  // Small files start right away (the panel is keyed by the file).
  const autoStart = file.size <= AUTO_START_BYTES;
  const [progress, setProgress] = useState<number | null>(autoStart ? 0 : null);
  const [failed, setFailed] = useState<string | null>(null);
  const [compare, setCompare] = useState('');
  const [copied, setCopied] = useState<HashAlgorithm | null>(null);
  const job = useRef<HashJob | null>(null);

  /** Runs the job; state only changes in its callbacks. */
  const launch = (algorithms: HashAlgorithm[]) => {
    job.current?.cancel();
    const current = computeHashes(file, algorithms, (done) =>
      setProgress(file.size === 0 ? 100 : (done / file.size) * 100),
    );
    job.current = current;
    current.result
      .then((r) => {
        if (job.current !== current) return;
        setResults(r);
        setProgress(null);
      })
      .catch((error: unknown) => {
        if (job.current !== current) return;
        setFailed(error instanceof Error ? error.message : String(error));
        setProgress(null);
      });
  };

  const start = (algorithms: HashAlgorithm[]) => {
    if (algorithms.length === 0) return;
    setFailed(null);
    setProgress(0);
    launch(algorithms);
  };

  useEffect(() => {
    if (autoStart) launch([...HASH_ALGORITHMS]);
    return () => job.current?.cancel();
    // Once per file: the panel is keyed by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = progress !== null;
  const comparison = compare.trim() ? compareHash(compare, results) : null;
  const toggle = (a: HashAlgorithm, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(a);
    else next.delete(a);
    setEnabled(next);
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 flex items-center gap-1 font-medium">
          {t('workshop.hashes.algorithms')}
          <HelpTip helpKey="workshop.hashes.algorithmsHelp" labelKey="workshop.hashes.algorithms" />
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {HASH_ALGORITHMS.map((a) => (
            <div key={a} className="flex items-center gap-2">
              <Switch
                id={`hash-${a}`}
                checked={enabled.has(a)}
                disabled={running}
                onCheckedChange={(on) => toggle(a, on)}
              />
              <Label htmlFor={`hash-${a}`}>{HASH_LABELS[a]}</Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button
            variant="outline"
            onClick={() => {
              job.current?.cancel();
              job.current = null;
              setProgress(null);
            }}
          >
            {t('workshop.hashes.cancel')}
          </Button>
        ) : (
          <Button
            onClick={() => start(HASH_ALGORITHMS.filter((a) => enabled.has(a)))}
            disabled={enabled.size === 0}
          >
            {t('workshop.hashes.compute')}
          </Button>
        )}
        {running && (
          <div className="flex min-w-48 flex-1 items-center gap-3 text-sm">
            <Loader2Icon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <Progress
              value={progress}
              className="flex-1"
              aria-label={t('workshop.hashes.progress')}
            />
            <span className="tabular-nums">{Math.floor(progress)} %</span>
          </div>
        )}
        {!running && Object.keys(results).length === 0 && file.size > AUTO_START_BYTES && (
          <p className="text-sm text-muted-foreground">
            {t('workshop.hashes.bigFile', { size: formatBytes(file.size, i18n.language) })}
          </p>
        )}
      </div>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.hashes.failed')} <span className="text-muted-foreground">({failed})</span>
        </p>
      )}

      {Object.keys(results).length > 0 && (
        <dl className="divide-y rounded-lg border">
          {HASH_ALGORITHMS.filter((a) => results[a]).map((a) => (
            <div key={a} className="flex items-center gap-3 px-3 py-2">
              <dt className="w-20 shrink-0 text-sm font-medium">{HASH_LABELS[a]}</dt>
              <dd className="min-w-0 flex-1 font-mono text-sm break-all">{results[a]}</dd>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('workshop.hashes.copy', { algorithm: HASH_LABELS[a] })}
                onClick={() => {
                  void navigator.clipboard?.writeText(results[a] ?? '').then(() => {
                    setCopied(a);
                    setTimeout(() => setCopied(null), 1500);
                  });
                }}
              >
                {copied === a ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              </Button>
            </div>
          ))}
        </dl>
      )}

      {results.sha256 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            saveBlob(
              new Blob([checksumFile(results.sha256 ?? '', file.name)], { type: 'text/plain' }),
              `${file.name}.sha256`,
            )
          }
        >
          <DownloadIcon aria-hidden="true" />
          {t('workshop.hashes.saveFile', { name: `${file.name}.sha256` })}
        </Button>
      )}

      <section className="space-y-2">
        <Label htmlFor="hash-compare" className="flex items-center gap-1">
          {t('workshop.hashes.compareLabel')}
          <HelpTip helpKey="workshop.hashes.compareHelp" labelKey="workshop.hashes.compareLabel" />
        </Label>
        <Input
          id="hash-compare"
          className="font-mono"
          placeholder={t('workshop.hashes.comparePlaceholder')}
          value={compare}
          onChange={(event) => setCompare(event.target.value)}
        />
        {comparison && !running && (
          <p
            role="status"
            className={cn(
              'flex items-start gap-2 text-sm',
              comparison.status === 'match' && 'text-emerald-700 dark:text-emerald-400',
              comparison.status === 'different' && 'text-destructive',
            )}
          >
            {comparison.status === 'match' ? (
              <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : comparison.status === 'different' ? (
              <CircleXIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            {comparison.status === 'match'
              ? t('workshop.hashes.match', { algorithm: HASH_LABELS[comparison.algorithm] })
              : comparison.status === 'different'
                ? t('workshop.hashes.different', {
                    algorithm: comparison.algorithms.map((a) => HASH_LABELS[a]).join(' / '),
                  })
                : comparison.status === 'not-computed'
                  ? t('workshop.hashes.notComputed', {
                      algorithm: comparison.algorithms.map((a) => HASH_LABELS[a]).join(' / '),
                    })
                  : t('workshop.hashes.invalid')}
          </p>
        )}
      </section>
    </div>
  );
}
