import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeOffIcon, Loader2Icon, ScanEyeIcon, SparklesIcon } from 'lucide-react';
import { chiSquareVerdict, type HiddenContent } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { stegoWorker, type StegoCover, type StegoResult } from '../workshop-worker';
import { AudioHide, AudioReveal } from './AudioStego';
import { FoundContent, OpenWithPassword } from './parts';
import { baseName, useErrorText, useHideForm, useObjectUrl, type Medium } from './use-stego';

/** Reads a picture's size and room in the worker whenever the file changes. */
function useCover(file: File | null) {
  const [state, setState] = useState<{ file: File; result: StegoResult<StegoCover> } | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    void stegoWorker.cover(file).then((result) => current && setState({ file, result }));
    return () => {
      current = false;
    };
  }, [file]);
  return state && state.file === file ? state.result : null;
}

function PictureNote({ cover }: { cover: StegoCover }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground">
      {t('workshop.stego.pictureInfo', { width: cover.width, height: cover.height })}
      {cover.format === 'other' && ` ${t('workshop.stego.becomesPng')}`}
    </p>
  );
}

function Hide() {
  const { t } = useTranslation();
  const errorText = useErrorText('picture');
  const form = useHideForm('picture');
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: Blob; name: string } | null>(null);
  const info = useCover(cover);
  const resultUrl = useObjectUrl(result?.file ?? null);
  const ready = info?.ok === true && form.hasContent;

  const run = async () => {
    if (!cover) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await stegoWorker.hide(cover, await form.content(), form.password, form.usedBits);
      if (r.ok)
        setResult({ file: r.value.file, name: `${baseName(cover.name, 'bild')}.${r.value.ext}` });
      else setError(errorText(r));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t('workshop.stego.cover')}</Label>
        <SingleFile
          file={cover}
          onFile={(f) => {
            setCover(f);
            setResult(null);
          }}
        />
        {info && !info.ok && (
          <p role="alert" className="text-sm text-destructive">
            {errorText(info)}
          </p>
        )}
        {info?.ok && <PictureNote cover={info.value} />}
        {info?.ok && info.value.hidden && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t('workshop.stego.alreadyHidden')}
          </p>
        )}
      </div>

      {form.fields(info?.ok ? form.roomOf(info.value.capacity) : null)}

      <Button onClick={() => void run()} disabled={!ready || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <EyeOffIcon aria-hidden="true" />
        )}
        {t(busy ? 'workshop.stego.hiding' : 'workshop.stego.hide')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {result && resultUrl && (
        <section className="space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <p className="flex items-center gap-2 font-medium" role="status">
            <SparklesIcon className="size-4 text-emerald-600" aria-hidden="true" />
            {t('workshop.stego.done')}
          </p>
          <img
            src={resultUrl}
            alt={t('workshop.stego.resultAlt')}
            className="max-h-64 rounded-md border"
          />
          <Button onClick={() => saveBlob(result.file, result.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.stego.save', { name: result.name })}
          </Button>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {t('workshop.stego.keepSafe')}
          </p>
        </section>
      )}
    </div>
  );
}

function Traces({ picture }: { picture: File }) {
  const { t } = useTranslation();
  const errorText = useErrorText('picture');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{
    file: File;
    result: StegoResult<{ plane: Blob; chi: number[] }>;
  } | null>(null);
  const shown = state?.file === picture ? state.result : null;
  const planeUrl = useObjectUrl(shown?.ok ? shown.value.plane : null);

  const run = async () => {
    setBusy(true);
    try {
      setState({ file: picture, result: await stegoWorker.traces(picture) });
    } finally {
      setBusy(false);
    }
  };

  const chi = shown?.ok ? shown.value.chi : [];
  const verdict = chiSquareVerdict(chi);

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">{t('workshop.stego.tracesTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t('workshop.stego.tracesIntro')}</p>
      <Button variant="outline" onClick={() => void run()} disabled={busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <ScanEyeIcon aria-hidden="true" />
        )}
        {t('workshop.stego.findTraces')}
      </Button>
      {shown && !shown.ok && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(shown)}
        </p>
      )}
      {shown?.ok && planeUrl && (
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="space-y-1">
            <img
              src={planeUrl}
              alt={t('workshop.stego.planeAlt')}
              className="max-h-72 w-full rounded-md border object-contain [image-rendering:pixelated]"
            />
            <figcaption className="text-xs text-muted-foreground">
              {t('workshop.stego.planeCaption')}
            </figcaption>
          </figure>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('workshop.stego.chiTitle')}</p>
            <div
              className="flex h-24 items-end gap-0.5 rounded-md border p-1"
              role="img"
              aria-label={t('workshop.stego.chiAlt', {
                values: chi.map((v) => Math.round(v * 100)).join(', '),
              })}
            >
              {chi.map((v, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${v > 0.5 ? 'bg-destructive' : 'bg-primary/40'}`}
                  style={{ height: `${Math.max(2, v * 100)}%` }}
                  title={`${(i + 1) * 5} %: ${Math.round(v * 100)} %`}
                />
              ))}
            </div>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>{t('workshop.stego.chiStart')}</span>
              <span>{t('workshop.stego.chiEnd')}</span>
            </p>
            <p className="text-sm" role="status">
              {verdict.kind === 'suspicious'
                ? t('workshop.stego.chiSuspicious', { percent: verdict.percent })
                : t(
                    verdict.kind === 'unclear'
                      ? 'workshop.stego.chiUnclear'
                      : 'workshop.stego.chiCalm',
                  )}
            </p>
            <p className="text-xs text-muted-foreground">{t('workshop.stego.chiLimits')}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Reveal() {
  const { t } = useTranslation();
  const errorText = useErrorText('picture');
  const [picture, setPicture] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    file: File;
    result: StegoResult<HiddenContent>;
  } | null>(null);
  const info = useCover(picture);
  const shown = outcome?.file === picture ? outcome.result : null;
  const hidden = info?.ok ? info.value.hidden : null;

  const open = async (file: File, pass: string) => {
    setBusy(true);
    try {
      setOutcome({ file, result: await stegoWorker.reveal(file, pass) });
    } finally {
      setBusy(false);
    }
  };

  // Open messages without a password right away.
  useEffect(() => {
    if (!picture || !hidden || hidden.encrypted) return;
    let current = true;
    void stegoWorker
      .reveal(picture, '')
      .then((result) => current && setOutcome({ file: picture, result }));
    return () => {
      current = false;
    };
  }, [picture, hidden]);

  return (
    <div className="space-y-4">
      <SingleFile file={picture} onFile={setPicture} />
      {info && !info.ok && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(info)}
        </p>
      )}
      {info?.ok && !hidden && (
        <p className="rounded-lg border p-3 text-sm" role="status">
          {t('workshop.stego.noneFound')}
        </p>
      )}
      {hidden?.encrypted && !shown?.ok && picture && (
        <OpenWithPassword
          key={`${picture.name}-${String(picture.lastModified)}`}
          medium="picture"
          busy={busy}
          onOpen={(pass) => void open(picture, pass)}
        />
      )}
      {shown && !shown.ok && shown.code !== 'needs-password' && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(shown)}
        </p>
      )}
      {shown?.ok && <FoundContent content={shown.value} />}
      {picture && info?.ok && <Traces picture={picture} />}
    </div>
  );
}

/**
 * Steganography: hide a message in the lowest bits of a picture or of the
 * samples of a sound file, and find it again.
 */
export function StegoTool({ medium = 'picture' }: { medium?: Medium }) {
  const { t } = useTranslation();
  const audio = medium === 'audio';
  return (
    <div className="space-y-4">
      <HowItWorks trick={audio ? 'audiostego' : 'stego'} />
      <Tabs defaultValue="hide" className="gap-4">
        <TabsList>
          <TabsTrigger value="hide">{t('workshop.stego.hideTab')}</TabsTrigger>
          <TabsTrigger value="reveal">{t('workshop.stego.revealTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="hide" forceMount className="data-[state=inactive]:hidden">
          {audio ? <AudioHide /> : <Hide />}
        </TabsContent>
        <TabsContent value="reveal" forceMount className="data-[state=inactive]:hidden">
          {audio ? <AudioReveal /> : <Reveal />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
