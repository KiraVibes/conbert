import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeOffIcon, Loader2Icon, SparklesIcon } from 'lucide-react';
import type { HiddenContent } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { asWav, extOf, ffmpeg } from '../audio-convert';
import { saveBlob } from '../save-blob';
import { SingleFile } from '../SingleFile';
import { audioStegoWorker, type AudioCover, type StegoResult } from '../workshop-worker';
import { FoundContent, OpenWithPassword } from './parts';
import { baseName, useErrorText, useHideForm, useObjectUrl } from './use-stego';

/**
 * Audio steganography: the bits go into a WAV file in the worker. Other
 * sound files (FLAC, MP3 …) are turned into WAV first with ffmpeg in the
 * browser, and a FLAC result is made from the finished WAV – FLAC packs
 * without losing a single bit, so the message survives.
 */

type Output = 'wav' | 'flac';
const NO_AUDIO = { ok: false, code: 'no-audio' } as const;

type Prepared = StegoResult<{ wav: Blob; info: AudioCover }>;

/** Turns the file into WAV (if needed) and reads its room in the worker. */
function useAudioCover(file: File | null): Prepared | 'preparing' | null {
  const [state, setState] = useState<{ file: File; result: Prepared } | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    void (async (): Promise<Prepared> => {
      try {
        const wav = await asWav(file, extOf(file.name) || 'wav');
        const info = await audioStegoWorker.cover(wav);
        return info.ok ? { ok: true, value: { wav, info: info.value } } : info;
      } catch {
        return NO_AUDIO;
      }
    })().then((result) => current && setState({ file, result }));
    return () => {
      current = false;
    };
  }, [file]);
  if (!file) return null;
  return state?.file === file ? state.result : 'preparing';
}

function Preparing({ file }: { file: File }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      {t(
        extOf(file.name) === 'wav'
          ? 'workshop.audioStego.reading'
          : 'workshop.audioStego.preparing',
      )}
    </p>
  );
}

function AudioNote({ info, ext }: { info: AudioCover; ext: string }) {
  const { t, i18n } = useTranslation();
  const minutes = Math.floor(info.seconds / 60);
  const seconds = String(Math.round(info.seconds % 60)).padStart(2, '0');
  return (
    <p className="text-sm text-muted-foreground">
      {t('workshop.audioStego.info', {
        length: `${String(minutes)}:${seconds}`,
        channels: t(
          info.channels === 1
            ? 'workshop.audioStego.mono'
            : info.channels === 2
              ? 'workshop.audioStego.stereo'
              : 'workshop.audioStego.channels',
          { count: info.channels },
        ),
        rate: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
          info.sampleRate / 1000,
        ),
        bits: info.bitsPerSample,
      })}
      {ext !== 'wav' && ext !== 'flac' && ` ${t('workshop.audioStego.becomesLossless')}`}
    </p>
  );
}

export function AudioHide() {
  const { t } = useTranslation();
  const errorText = useErrorText('audio');
  const form = useHideForm('audio');
  const [cover, setCover] = useState<File | null>(null);
  const [output, setOutput] = useState<Output>('flac');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: Blob; name: string } | null>(null);
  const prepared = useAudioCover(cover);
  const info = prepared !== 'preparing' ? prepared : null;
  const resultUrl = useObjectUrl(result?.file ?? null);
  const ready = info?.ok === true && form.hasContent;

  const run = async () => {
    if (!cover || !info?.ok) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let { wav } = info.value;
      const { bitsPerSample, float } = info.value.info;
      // FLAC is turned back into 16-bit WAV for reading, so hide in 16-bit samples.
      if (output === 'flac' && (bitsPerSample !== 16 || float))
        wav = await ffmpeg(wav, 'wav', 'wav');
      const hidden = await audioStegoWorker.hide(
        wav,
        await form.content(),
        form.password,
        form.usedBits,
      );
      if (!hidden.ok) {
        setError(errorText(hidden));
        return;
      }
      let file = hidden.value;
      if (output === 'flac') {
        file = await ffmpeg(hidden.value, 'wav', 'flac');
        // Check that the message made it through FLAC before handing it out.
        const check = await audioStegoWorker.cover(await ffmpeg(file, 'flac', 'wav'));
        if (!check.ok || !check.value.hidden) {
          setError(errorText({ ok: false, code: 'damaged' }));
          return;
        }
      }
      setResult({ file, name: `${baseName(cover.name, 'ton')}.${output}` });
    } catch {
      setError(errorText(NO_AUDIO));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t('workshop.audioStego.cover')}</Label>
        <SingleFile
          file={cover}
          onFile={(f) => {
            setCover(f);
            setResult(null);
            setError(null);
            if (f) setOutput(extOf(f.name) === 'wav' ? 'wav' : 'flac');
          }}
        />
        {cover && prepared === 'preparing' && <Preparing file={cover} />}
        {info && !info.ok && (
          <p role="alert" className="text-sm text-destructive">
            {errorText(info)}
          </p>
        )}
        {info?.ok && cover && <AudioNote info={info.value.info} ext={extOf(cover.name)} />}
        {info?.ok && info.value.info.hidden && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t('workshop.audioStego.alreadyHidden')}
          </p>
        )}
      </div>

      {form.fields(info?.ok ? form.roomOf(info.value.info.capacity) : null)}

      <div className="space-y-1">
        <Label className="flex items-center gap-1">
          {t('workshop.audioStego.output')}
          <HelpTip helpKey="workshop.audioStego.outputHelp" labelKey="workshop.audioStego.output" />
        </Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={output}
          onValueChange={(v) => v && setOutput(v as Output)}
          aria-label={t('workshop.audioStego.output')}
        >
          <ToggleGroupItem value="flac">{t('workshop.audioStego.outputFlac')}</ToggleGroupItem>
          <ToggleGroupItem value="wav">{t('workshop.audioStego.outputWav')}</ToggleGroupItem>
        </ToggleGroup>
      </div>

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
            {t('workshop.audioStego.done')}
          </p>
          <audio
            controls
            src={resultUrl}
            className="w-full max-w-md"
            aria-label={t('workshop.audioStego.resultAlt')}
          />
          <Button onClick={() => saveBlob(result.file, result.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.stego.save', { name: result.name })}
          </Button>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {t('workshop.audioStego.keepSafe')}
          </p>
        </section>
      )}
    </div>
  );
}

export function AudioReveal() {
  const { t } = useTranslation();
  const errorText = useErrorText('audio');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    file: File;
    result: StegoResult<HiddenContent>;
  } | null>(null);
  const prepared = useAudioCover(file);
  const info = prepared !== 'preparing' ? prepared : null;
  const shown = outcome?.file === file ? outcome.result : null;
  const hidden = info?.ok ? info.value.info.hidden : null;
  const wav = info?.ok ? info.value.wav : null;

  const open = async (target: File, from: Blob, pass: string) => {
    setBusy(true);
    try {
      setOutcome({ file: target, result: await audioStegoWorker.reveal(from, pass) });
    } finally {
      setBusy(false);
    }
  };

  // Open messages without a password right away.
  useEffect(() => {
    if (!file || !wav || !hidden || hidden.encrypted) return;
    let current = true;
    void audioStegoWorker.reveal(wav, '').then((result) => current && setOutcome({ file, result }));
    return () => {
      current = false;
    };
  }, [file, wav, hidden]);

  return (
    <div className="space-y-4">
      <SingleFile file={file} onFile={setFile} />
      {file && prepared === 'preparing' && <Preparing file={file} />}
      {info && !info.ok && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(info)}
        </p>
      )}
      {info?.ok && !hidden && (
        <p className="rounded-lg border p-3 text-sm" role="status">
          {t('workshop.audioStego.noneFound')}
        </p>
      )}
      {hidden?.encrypted && !shown?.ok && file && wav && (
        <OpenWithPassword
          key={`${file.name}-${String(file.lastModified)}`}
          medium="audio"
          busy={busy}
          onOpen={(pass) => void open(file, wav, pass)}
        />
      )}
      {shown && !shown.ok && shown.code !== 'needs-password' && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(shown)}
        </p>
      )}
      {shown?.ok && <FoundContent content={shown.value} />}
    </div>
  );
}
