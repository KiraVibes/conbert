import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, PlayIcon, SquareIcon } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import {
  RINGTONE_DEFAULT_SECONDS,
  RINGTONE_FORMATS,
  RINGTONE_MAX_FADE,
  RINGTONE_MAX_SECONDS,
  applyFades,
  clampPart,
  cutChannels,
  encodeWavChannels,
  formatTimecode,
  normalizePeak,
  waveformPeaks,
  type RingtoneFormat,
} from '@conbert/core';
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
import { Switch } from '@/components/ui/switch';
import { ffmpegWasmEngine } from '@/engines/ffmpeg-wasm';
import { saveBlob } from '@/lib/zip';
import { extOf, ffmpeg } from '../audio-convert';
import { FunSlider } from '../fun/FunParts';
import { HowItWorks, SingleFile } from '../SingleFile';

interface Song {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  peaks: Float32Array;
}

const RATE = 44_100;
const BARS = 240;

async function decodeChannels(blob: Blob): Promise<Song> {
  const context = new OfflineAudioContext(2, 1, RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) =>
    buffer.getChannelData(c),
  );
  return {
    channels,
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
    peaks: waveformPeaks(channels, BARS),
  };
}

/** Decodes with the browser; what it can't read (e.g. some videos) goes through ffmpeg.wasm. */
async function loadSong(file: File): Promise<Song> {
  try {
    return await decodeChannels(file);
  } catch {
    const ext = extOf(file.name);
    if (!ext || ext === 'wav') throw new Error('not a sound file');
    return decodeChannels(await ffmpeg(file, ext, 'wav'));
  }
}

interface Settings {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  louder: boolean;
}

/** The chosen part as WAV, with fades and (optionally) as loud as possible. */
function renderPart(song: Song, s: Settings): Blob {
  const part = cutChannels(song.channels, song.sampleRate, s.start, s.end);
  applyFades(part, song.sampleRate, s.fadeIn, s.fadeOut);
  if (s.louder) normalizePeak(part, -1);
  return new Blob([encodeWavChannels(part, song.sampleRate) as Uint8Array<ArrayBuffer>], {
    type: 'audio/wav',
  });
}

function Waveform({
  song,
  start,
  end,
  onPick,
}: {
  song: Song;
  start: number;
  end: number;
  onPick: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const width = el.clientWidth * devicePixelRatio;
    const height = el.clientHeight * devicePixelRatio;
    el.width = width;
    el.height = height;
    const style = getComputedStyle(el);
    const muted = style.getPropertyValue('--muted-foreground').trim() || '#888';
    const primary = style.getPropertyValue('--primary').trim() || '#6d28d9';
    const bar = width / song.peaks.length;
    song.peaks.forEach((peak, i) => {
      const time = ((i + 0.5) / song.peaks.length) * song.duration;
      ctx.fillStyle = time >= start && time <= end ? primary : muted;
      ctx.globalAlpha = time >= start && time <= end ? 1 : 0.45;
      const h = Math.max(2, peak * height * 0.95);
      ctx.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 1), h);
    });
  }, [song, start, end]);
  return (
    <canvas
      ref={canvas}
      className="h-24 w-full cursor-pointer rounded border bg-muted/30"
      role="img"
      aria-label={t('workshop.ringtone.waveform')}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - rect.left) / rect.width) * song.duration);
      }}
    />
  );
}

/** Klingelton-Maker: a part of a song with soft start and end, as MP3 or M4R. */
export function RingtoneTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  /** The decoded song and the file it belongs to (a newer file means: still loading). */
  const [loaded, setLoaded] = useState<{ file: File; song: Song | null } | null>(null);
  const [range, setRange] = useState({ start: 0, end: RINGTONE_DEFAULT_SECONDS });
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(2);
  const [louder, setLouder] = useState(true);
  const [format, setFormat] = useState<RingtoneFormat>('mp3');
  const [making, setMaking] = useState(false);
  const [makeFailed, setMakeFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    loadSong(file)
      .then((song) => {
        if (!active) return;
        setLoaded({ file, song });
        setRange(clampPart(0, RINGTONE_DEFAULT_SECONDS, song.duration));
      })
      .catch(() => active && setLoaded({ file, song: null }));
    return () => {
      active = false;
    };
  }, [file]);
  const current = loaded && loaded.file === file ? loaded : null;
  const song = current?.song ?? null;
  const loading = file !== null && current === null;
  const loadFailed = current !== null && current.song === null;

  const stop = () => {
    audio.current?.pause();
    if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
    audio.current = null;
    setPlaying(false);
  };
  // Stop playing when leaving the page.
  useEffect(
    () => () => {
      const el = audio.current;
      el?.pause();
      if (el?.src) URL.revokeObjectURL(el.src);
    },
    [],
  );

  const length = range.end - range.start;
  const settings = useMemo(
    () => ({ ...range, fadeIn, fadeOut, louder }),
    [range, fadeIn, fadeOut, louder],
  );
  const fadesTooLong = fadeIn + fadeOut > length;

  const setStart = (start: number) => {
    if (!song) return;
    stop();
    setRange(clampPart(start, start + length, song.duration));
  };

  const play = () => {
    if (!song) return;
    stop();
    const el = new Audio(URL.createObjectURL(renderPart(song, settings)));
    el.onended = stop;
    audio.current = el;
    setPlaying(true);
    void el.play().catch(stop);
  };

  const make = async () => {
    if (!song || !file) return;
    setMaking(true);
    setMakeFailed(false);
    try {
      const wav = renderPart(song, settings);
      // M4R is an M4A (AAC sound) with another ending – that is what iPhones want.
      const out = await ffmpegWasmEngine.convert({
        input: wav,
        inputExt: 'wav',
        outputExt: format === 'm4r' ? 'm4a' : 'mp3',
        options: { audioBitrate: format === 'm4r' ? '160' : '192' },
      });
      if (typeof out === 'string') throw new Error('unexpected path from a browser engine');
      const base = file.name.replace(/\.[^.]+$/, '') || 'ringtone';
      saveBlob(
        new Blob([out], { type: format === 'm4r' ? 'audio/mp4' : 'audio/mpeg' }),
        `${base}-${t('workshop.ringtone.fileSuffix')}.${format}`,
      );
    } catch {
      setMakeFailed(true);
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="ringtone" />
      <SingleFile
        file={file}
        onFile={(f) => {
          stop();
          setFile(f);
        }}
      />
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.ringtone.loading')}
        </p>
      )}
      {loadFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.ringtone.loadFailed')}
        </p>
      )}
      {song && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {t('workshop.ringtone.part', {
                start: formatTimecode(range.start),
                end: formatTimecode(range.end),
                length: Math.round(length),
              })}
              <HelpTip
                helpKey="workshop.ringtone.partHelp"
                labelKey="workshop.ringtone.partLabel"
              />
            </Label>
            <Waveform song={song} start={range.start} end={range.end} onPick={setStart} />
            <SliderPrimitive.Root
              className="relative flex h-6 w-full touch-none items-center select-none"
              min={0}
              max={song.duration}
              step={0.1}
              minStepsBetweenThumbs={10}
              value={[range.start, range.end]}
              onValueChange={([s, e]) => {
                stop();
                // Moving the end beyond 40 s pulls the start along.
                const start = s ?? range.start;
                const end = e ?? range.end;
                setRange(
                  end - start > RINGTONE_MAX_SECONDS && start === range.start
                    ? clampPart(end - RINGTONE_MAX_SECONDS, end, song.duration)
                    : clampPart(start, end, song.duration),
                );
              }}
            >
              <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-muted">
                <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
              </SliderPrimitive.Track>
              {[t('workshop.ringtone.start'), t('workshop.ringtone.end')].map((label) => (
                <SliderPrimitive.Thumb
                  key={label}
                  aria-label={label}
                  className="block size-4 rounded-full border-2 border-primary bg-background shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              ))}
            </SliderPrimitive.Root>
            <p className="text-xs text-muted-foreground">
              {t('workshop.ringtone.partHint', { max: RINGTONE_MAX_SECONDS })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FunSlider
              label={t('workshop.ringtone.fadeIn', { value: fadeIn })}
              labelKey="workshop.ringtone.fadeInLabel"
              helpKey="workshop.ringtone.fadeHelp"
              value={fadeIn}
              min={0}
              max={RINGTONE_MAX_FADE}
              step={0.5}
              onChange={(v) => {
                stop();
                setFadeIn(v);
              }}
            />
            <FunSlider
              label={t('workshop.ringtone.fadeOut', { value: fadeOut })}
              labelKey="workshop.ringtone.fadeOutLabel"
              helpKey="workshop.ringtone.fadeHelp"
              value={fadeOut}
              min={0}
              max={RINGTONE_MAX_FADE}
              step={0.5}
              onChange={(v) => {
                stop();
                setFadeOut(v);
              }}
            />
          </div>
          {fadesTooLong && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('workshop.ringtone.fadesTooLong')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Switch
                id="ringtone-louder"
                checked={louder}
                onCheckedChange={(v) => {
                  stop();
                  setLouder(v);
                }}
              />
              <Label htmlFor="ringtone-louder" className="flex items-center gap-1">
                {t('workshop.ringtone.louder')}
                <HelpTip
                  helpKey="workshop.ringtone.louderHelp"
                  labelKey="workshop.ringtone.louder"
                />
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ringtone-format" className="flex items-center gap-1">
                {t('workshop.ringtone.format')}
                <HelpTip
                  helpKey="workshop.ringtone.formatHelp"
                  labelKey="workshop.ringtone.format"
                />
              </Label>
              <Select value={format} onValueChange={(v) => setFormat(v as RingtoneFormat)}>
                <SelectTrigger id="ringtone-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RINGTONE_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`workshop.ringtone.formats.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={playing ? stop : play}>
              {playing ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
              {playing ? t('workshop.ringtone.stop') : t('workshop.ringtone.listen')}
            </Button>
            <Button onClick={() => void make()} disabled={making}>
              {making ? (
                <Loader2Icon
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
              {making
                ? t('workshop.fun.working')
                : t('workshop.ringtone.make', { ext: format.toUpperCase() })}
            </Button>
          </div>
          {makeFailed && (
            <p role="alert" className="text-sm text-destructive">
              {t('workshop.ringtone.makeFailed')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t(format === 'm4r' ? 'workshop.ringtone.iphoneHint' : 'workshop.ringtone.androidHint')}
          </p>
        </div>
      )}
    </div>
  );
}
