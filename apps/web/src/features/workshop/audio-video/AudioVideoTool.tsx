import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, SquareIcon, VideoIcon } from 'lucide-react';
import {
  ConversionError,
  VISUALIZER_COLORS,
  VISUALIZER_COVER_TYPES,
  VISUALIZER_INPUTS,
  VISUALIZER_SIZES,
  VISUALIZER_STYLES,
  isAbortError,
  type VisualizerColor,
  type VisualizerSize,
  type VisualizerStyle,
} from '@conbert/core';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { convertOnServer } from '@/engines/server-convert';
import { formatBytes } from '@/lib/format-bytes';
import { saveBlob } from '@/lib/zip';
import { extOf } from '../audio-convert';
import { HowItWorks, SingleFile } from '../SingleFile';

const CONTAINERS = ['mp4', 'webm'] as const;
type Container = (typeof CONTAINERS)[number];

function OptionSelect<T extends string>({
  id,
  optionKey,
  value,
  values,
  onChange,
}: {
  id: string;
  optionKey: string;
  value: T;
  values: readonly T[];
  onChange: (v: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1">
        {t(`options.${optionKey}.label`)}
        <HelpTip helpKey={`options.${optionKey}.help`} labelKey={`options.${optionKey}.label`} />
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {t(`options.${optionKey}.choices.${v}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A song or podcast becomes a video with a waveform and cover (on the server). */
export function AudioVideoTool() {
  const { t, i18n } = useTranslation();
  const [sound, setSound] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [style, setStyle] = useState<VisualizerStyle>('wave');
  const [size, setSize] = useState<VisualizerSize>('landscape720');
  const [color, setColor] = useState<VisualizerColor>('violet');
  const [container, setContainer] = useState<Container>('mp4');
  const [busy, setBusy] = useState<{
    percent: number;
    stage?: string;
    abort: AbortController;
  } | null>(null);
  const [error, setError] = useState<{ messageKey: string; details?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const url = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const soundExt = sound ? extOf(sound.name) : '';
  const soundOk = !sound || VISUALIZER_INPUTS.includes(soundExt);
  const coverOk = !cover || VISUALIZER_COVER_TYPES.includes(extOf(cover.name));

  const make = async () => {
    if (!sound) return;
    const abort = new AbortController();
    setBusy({ percent: 0, abort });
    setError(null);
    setResult(null);
    try {
      const blob = await convertOnServer({
        file: sound,
        fileName: sound.name,
        outputExt: container,
        options: {
          vizStyle: style,
          vizSize: size,
          vizColor: color,
          ...(cover && { vizCover: cover }),
        },
        signal: abort.signal,
        onProgress: ({ percent, stage }) => setBusy({ percent, ...(stage && { stage }), abort }),
      });
      setResult({ blob, name: `${sound.name.replace(/\.[^.]+$/, '')}.${container}` });
    } catch (err) {
      if (isAbortError(err)) return;
      console.error('audio to video failed', err);
      setError(
        err instanceof ConversionError
          ? { messageKey: err.messageKey, ...(err.details && { details: err.details }) }
          : { messageKey: 'errors.convertFailed', details: String(err) },
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="audiovideo" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('workshop.audiovideo.sound')}</p>
          <SingleFile file={sound} onFile={setSound} />
        </div>
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-sm font-medium">
            {t('workshop.audiovideo.cover')}
            <HelpTip helpKey="options.vizCover.help" labelKey="options.vizCover.label" />
          </p>
          <SingleFile file={cover} onFile={setCover} />
        </div>
      </div>
      {!soundOk && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.audiovideo.notSound')}
        </p>
      )}
      {!coverOk && (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.coverInvalid.cause')}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 flex items-center gap-1 text-sm font-medium">
          {t('options.vizStyle.label')}
          <HelpTip helpKey="options.vizStyle.help" labelKey="options.vizStyle.label" />
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {VISUALIZER_STYLES.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="viz-style"
                value={s}
                checked={style === s}
                onChange={() => setStyle(s)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{t(`options.vizStyle.choices.${s}`)}</span>
                <span className="text-muted-foreground">
                  {t(`options.vizStyle.choiceHelp.${s}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <OptionSelect
          id="viz-size"
          optionKey="vizSize"
          value={size}
          values={VISUALIZER_SIZES}
          onChange={setSize}
        />
        <OptionSelect
          id="viz-color"
          optionKey="vizColor"
          value={color}
          values={VISUALIZER_COLORS}
          onChange={setColor}
        />
        <div className="space-y-2">
          <Label htmlFor="viz-container">{t('workshop.audiovideo.container')}</Label>
          <Select value={container} onValueChange={(v) => setContainer(v as Container)}>
            <SelectTrigger id="viz-container" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTAINERS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void make()}
          disabled={!sound || !soundOk || !coverOk || busy !== null}
        >
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <VideoIcon aria-hidden="true" />
          )}
          {busy
            ? busy.stage === 'uploading'
              ? t('workshop.audiovideo.uploading', { percent: busy.percent })
              : t('workshop.audiovideo.making', { percent: busy.percent })
            : t('workshop.audiovideo.make')}
        </Button>
        {busy && (
          <Button variant="outline" onClick={() => busy.abort.abort()}>
            <SquareIcon aria-hidden="true" />
            {t('workshop.audiovideo.stop')}
          </Button>
        )}
      </div>

      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      {result && url && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <video src={url} controls className="max-h-96 w-full rounded-md bg-black" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => saveBlob(result.blob, result.name)}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.audiovideo.save')}
            </Button>
            <span className="text-sm text-muted-foreground" role="status">
              {t('workshop.audiovideo.done', {
                size: formatBytes(result.blob.size, i18n.language),
              })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
