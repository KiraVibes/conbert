import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClapperboardIcon, DownloadIcon, Loader2Icon } from 'lucide-react';
import { frameCapacity, type AssembleResult } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { VIDEO_FPS, VIDEO_MAX_BYTES, layoutFor, makeDataVideo, readDataVideo } from './video-data';

const BLOCKS = [8, 16] as const;

function Pack() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [block, setBlock] = useState<(typeof BLOCKS)[number]>(16);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const seconds = file ? Math.ceil(file.size / frameCapacity(layoutFor(block)) / VIDEO_FPS) : 0;

  async function make() {
    if (!file) return;
    setProgress(0);
    setError(false);
    abort.current = new AbortController();
    try {
      const video = await makeDataVideo(
        { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
        block,
        setProgress,
        abort.current.signal,
      );
      saveBlob(video, `${file.name}.${video.type === 'video/mp4' ? 'mp4' : 'webm'}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e);
        setError(true);
      }
    } finally {
      setProgress(null);
    }
  }

  const tooBig = file !== null && file.size > VIDEO_MAX_BYTES;
  return (
    <div className="space-y-3">
      <SingleFile file={file} onFile={setFile} />
      <div className="max-w-sm space-y-1">
        <Label htmlFor="datavideo-block">{t('workshop.datavideo.block')}</Label>
        <Select value={String(block)} onValueChange={(v) => setBlock(Number(v) as 8 | 16)}>
          <SelectTrigger id="datavideo-block" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCKS.map((b) => (
              <SelectItem key={b} value={String(b)}>
                {t(`workshop.datavideo.blocks.${b}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {file && !tooBig && (
        <p className="text-sm text-muted-foreground">
          {t('workshop.datavideo.length', { seconds: Math.max(1, seconds) })}
        </p>
      )}
      {tooBig && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.datavideo.tooBig')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void make()} disabled={!file || tooBig || progress !== null}>
          {progress !== null ? (
            <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ClapperboardIcon aria-hidden="true" />
          )}
          {t('workshop.datavideo.make')}
        </Button>
        {progress !== null && (
          <Button variant="outline" onClick={() => abort.current?.abort()}>
            {t('workshop.datavideo.cancel')}
          </Button>
        )}
      </div>
      {progress !== null && (
        <Progress
          value={progress * 100}
          className="max-w-sm"
          aria-label={t('workshop.datavideo.make')}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.datavideo.failed')}
        </p>
      )}
    </div>
  );
}

function Unpack() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<AssembleResult | null>(null);
  const [error, setError] = useState(false);

  async function read(f: File) {
    setProgress(0);
    setResult(null);
    setError(false);
    try {
      setResult(await readDataVideo(f, setProgress));
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          if (f) void read(f);
        }}
      />
      {progress !== null && (
        <Progress
          value={progress * 100}
          className="max-w-sm"
          aria-label={t('workshop.datavideo.reading')}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.datavideo.readFailed')}
        </p>
      )}
      {result && (
        <div className="space-y-2" data-testid="datavideo-result">
          {result.ok ? (
            <>
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                {t('workshop.datavideo.restored', { name: result.file.name })}
              </p>
              <Button
                onClick={() =>
                  saveBlob(
                    new Blob([result.file.bytes as Uint8Array<ArrayBuffer>]),
                    result.file.name,
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.datavideo.download', { name: result.file.name })}
              </Button>
            </>
          ) : (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {result.reason === 'missing'
                ? t('workshop.datavideo.missing', {
                    found: result.total - result.missing.length,
                    total: result.total,
                  })
                : t(`workshop.datavideo.${result.reason}`)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Daten im Video – any file as a video of black and white blocks, and back. */
export function DataVideoTool() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'pack' | 'unpack'>('pack');
  return (
    <div className="space-y-4">
      <HowItWorks trick="datavideo" />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['pack', 'unpack'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={tab === m}
            onClick={() => setTab(m)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              tab === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {t(`workshop.datavideo.tabs.${m}`)}
          </button>
        ))}
      </div>
      {tab === 'pack' ? <Pack /> : <Unpack />}
    </div>
  );
}
