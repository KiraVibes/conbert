import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLinesIcon,
  DownloadIcon,
  Loader2Icon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { TONE_DEFAULTS } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettings } from '@/features/settings/settings-store';
import { decodeSound } from '../audio-convert';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { spectroWorker, type SpectrogramPicture, type ToneResult } from '../workshop-worker';
import { baseName, useObjectUrl } from '../stego/use-stego';

const kHz = (hz: number, language: string) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(hz / 1000);

/** The spectrogram picture with its axes, and a button to save it. */
function SpectrogramView({ result, name }: { result: SpectrogramPicture; name: string }) {
  const { t, i18n } = useTranslation();
  const url = useObjectUrl(result.picture);
  const seconds = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
    result.seconds,
  );
  if (!url) return null;
  return (
    <figure className="space-y-2">
      <div className="flex gap-2">
        <div
          className="flex h-64 w-14 shrink-0 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums"
          aria-hidden="true"
        >
          <span>{t('workshop.spectrogram.kHz', { value: kHz(result.maxHz, i18n.language) })}</span>
          <span>
            {t('workshop.spectrogram.kHz', { value: kHz(result.maxHz / 2, i18n.language) })}
          </span>
          <span>{t('workshop.spectrogram.kHz', { value: 0 })}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <img
            src={url}
            alt={t('workshop.spectrogram.pictureAlt', { name })}
            className="h-64 w-full rounded-md border bg-black object-fill"
            data-testid="spectrogram-picture"
          />
          <p
            className="flex justify-between text-xs text-muted-foreground tabular-nums"
            aria-hidden="true"
          >
            <span>0 s</span>
            <span>{t('workshop.spectrogram.time')}</span>
            <span>{seconds} s</span>
          </p>
        </div>
      </div>
      <figcaption className="text-sm text-muted-foreground">
        {t('workshop.spectrogram.howToRead')}
      </figcaption>
      <Button
        variant="outline"
        size="sm"
        onClick={() => saveBlob(result.picture, `${baseName(name, 'ton')}-spektrogramm.png`)}
      >
        <DownloadIcon aria-hidden="true" />
        {t('workshop.spectrogram.savePicture')}
      </Button>
    </figure>
  );
}

type Brightness = 'auto' | 'light' | 'dark';

function ToSound() {
  const { t } = useTranslation();
  const expert = useSettings((s) => s.expertMode);
  const [picture, setPicture] = useState<File | null>(null);
  const [seconds, setSeconds] = useState(TONE_DEFAULTS.seconds);
  const [brightness, setBrightness] = useState<Brightness>('auto');
  const [minHz, setMinHz] = useState(TONE_DEFAULTS.minHz);
  const [maxHz, setMaxHz] = useState(TONE_DEFAULTS.maxHz);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ file: File; value: ToneResult } | null>(null);
  const shown = result?.file === picture ? result.value : null;
  const soundUrl = useObjectUrl(shown?.ok ? shown.value.sound : null);
  const low = expert ? Math.max(20, Math.min(minHz, maxHz - 100)) : TONE_DEFAULTS.minHz;
  const high = expert ? Math.min(22_000, Math.max(maxHz, low + 100)) : TONE_DEFAULTS.maxHz;

  const run = async () => {
    if (!picture) return;
    setBusy(true);
    try {
      const invert = brightness === 'auto' ? 'auto' : brightness === 'dark';
      const value = await spectroWorker.pictureToSound(
        picture,
        { seconds, minHz: low, maxHz: high },
        invert,
      );
      setResult({ file: picture, value });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t('workshop.spectrogram.picture')}</Label>
        <SingleFile file={picture} onFile={setPicture} />
        <p className="text-xs text-muted-foreground">{t('workshop.spectrogram.pictureHint')}</p>
      </div>

      <div className="max-w-sm space-y-2">
        <Label className="flex items-center gap-1">
          {t('workshop.spectrogram.seconds', { seconds })}
          <HelpTip
            helpKey="workshop.spectrogram.secondsHelp"
            effectKey="workshop.spectrogram.secondsEffect"
            labelKey="workshop.spectrogram.secondsLabel"
          />
        </Label>
        <Slider
          min={3}
          max={30}
          step={1}
          value={[seconds]}
          onValueChange={(v) => setSeconds(v[0] ?? TONE_DEFAULTS.seconds)}
          aria-label={t('workshop.spectrogram.secondsLabel')}
        />
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1">
          {t('workshop.spectrogram.brightness')}
          <HelpTip
            helpKey="workshop.spectrogram.brightnessHelp"
            labelKey="workshop.spectrogram.brightness"
          />
        </Label>
        <ToggleGroup
          type="single"
          variant="outline"
          className="flex-wrap"
          value={brightness}
          onValueChange={(v) => v && setBrightness(v as Brightness)}
          aria-label={t('workshop.spectrogram.brightness')}
        >
          <ToggleGroupItem value="auto">{t('workshop.spectrogram.auto')}</ToggleGroupItem>
          <ToggleGroupItem value="light">{t('workshop.spectrogram.light')}</ToggleGroupItem>
          <ToggleGroupItem value="dark">{t('workshop.spectrogram.dark')}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {expert && (
        <fieldset className="space-y-1">
          <legend className="flex items-center gap-1 text-sm font-medium">
            {t('workshop.spectrogram.range')}
            <HelpTip
              helpKey="workshop.spectrogram.rangeHelp"
              labelKey="workshop.spectrogram.range"
            />
          </legend>
          <div className="flex flex-wrap gap-3">
            <div className="w-40 space-y-1">
              <Label htmlFor="spectro-min">{t('workshop.spectrogram.minHz')}</Label>
              <Input
                id="spectro-min"
                type="number"
                min={20}
                max={21_000}
                value={minHz}
                onChange={(e) => setMinHz(Number(e.target.value) || 0)}
              />
            </div>
            <div className="w-40 space-y-1">
              <Label htmlFor="spectro-max">{t('workshop.spectrogram.maxHz')}</Label>
              <Input
                id="spectro-max"
                type="number"
                min={120}
                max={22_000}
                value={maxHz}
                onChange={(e) => setMaxHz(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </fieldset>
      )}

      <Button onClick={() => void run()} disabled={!picture || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <AudioLinesIcon aria-hidden="true" />
        )}
        {t(busy ? 'workshop.spectrogram.making' : 'workshop.spectrogram.make')}
      </Button>

      {shown && !shown.ok && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.spectrogram.errors.noPicture')}
        </p>
      )}
      {shown?.ok && soundUrl && picture && (
        <section className="space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <p className="flex items-center gap-2 font-medium" role="status">
            <SparklesIcon className="size-4 text-emerald-600" aria-hidden="true" />
            {t('workshop.spectrogram.done')}
          </p>
          {shown.value.inverted && brightness === 'auto' && (
            <p className="text-sm text-muted-foreground">
              {t('workshop.spectrogram.invertedNote')}
            </p>
          )}
          <p className="flex gap-2 text-sm">
            <TriangleAlertIcon
              className="mt-0.5 size-4 shrink-0 text-amber-500"
              aria-hidden="true"
            />
            {t('workshop.spectrogram.loud')}
          </p>
          <audio
            controls
            src={soundUrl}
            className="w-full max-w-md"
            aria-label={t('workshop.spectrogram.soundAlt')}
          />
          <Button
            onClick={() => saveBlob(shown.value.sound, `${baseName(picture.name, 'bild')}.wav`)}
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.spectrogram.save', { name: `${baseName(picture.name, 'bild')}.wav` })}
          </Button>
          <SpectrogramView result={shown.value.spectrogram} name={`${picture.name}.wav`} />
          <p className="text-sm text-muted-foreground">
            {t('workshop.spectrogram.elsewhere', { min: low, max: high })}
          </p>
        </section>
      )}
    </div>
  );
}

type Fineness = 1024 | 2048 | 4096;

function View() {
  const { t } = useTranslation();
  const expert = useSettings((s) => s.expertMode);
  const [file, setFile] = useState<File | null>(null);
  const [fineness, setFineness] = useState<Fineness>(2048);
  const [state, setState] = useState<{
    file: File;
    fineness: Fineness;
    result: SpectrogramPicture | 'failed';
  } | null>(null);
  const size: Fineness = expert ? fineness : 2048;
  const shown = state?.file === file && state.fineness === size ? state.result : null;

  useEffect(() => {
    if (!file) return;
    let current = true;
    void (async () => {
      try {
        const sound = await decodeSound(file);
        const result = await spectroWorker.spectrogram(sound.samples, sound.sampleRate, size);
        if (current) setState({ file, fineness: size, result });
      } catch {
        if (current) setState({ file, fineness: size, result: 'failed' });
      }
    })();
    return () => {
      current = false;
    };
  }, [file, size]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t('workshop.spectrogram.sound')}</Label>
        <SingleFile file={file} onFile={setFile} />
      </div>
      {expert && (
        <div className="space-y-1">
          <Label className="flex items-center gap-1">
            {t('workshop.spectrogram.fineness')}
            <HelpTip
              helpKey="workshop.spectrogram.finenessHelp"
              labelKey="workshop.spectrogram.fineness"
            />
          </Label>
          <ToggleGroup
            type="single"
            variant="outline"
            className="flex-wrap"
            value={String(fineness)}
            onValueChange={(v) => v && setFineness(Number(v) as Fineness)}
            aria-label={t('workshop.spectrogram.fineness')}
          >
            <ToggleGroupItem value="1024">{t('workshop.spectrogram.fineTime')}</ToggleGroupItem>
            <ToggleGroupItem value="2048">{t('workshop.spectrogram.fineBalanced')}</ToggleGroupItem>
            <ToggleGroupItem value="4096">{t('workshop.spectrogram.fineTone')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      {file && !shown && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('workshop.spectrogram.reading')}
        </p>
      )}
      {shown === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.spectrogram.errors.noAudio')}
        </p>
      )}
      {shown && shown !== 'failed' && file && <SpectrogramView result={shown} name={file.name} />}
    </div>
  );
}

/** Picture in the spectrogram: a picture as sound, and the spectrogram of any sound. */
export function SpectrogramTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="spectrogram" />
      <Tabs defaultValue="toSound" className="gap-4">
        <TabsList>
          <TabsTrigger value="toSound">{t('workshop.spectrogram.toSoundTab')}</TabsTrigger>
          <TabsTrigger value="view">{t('workshop.spectrogram.viewTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="toSound" forceMount className="data-[state=inactive]:hidden">
          <ToSound />
        </TabsContent>
        <TabsContent value="view" forceMount className="data-[state=inactive]:hidden">
          <View />
        </TabsContent>
      </Tabs>
    </div>
  );
}
