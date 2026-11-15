import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import {
  POSTER_FONTS,
  POSTER_FORMATS,
  POSTER_STYLES,
  posterPeaks,
  posterSlices,
  soundPosterSvg,
  type PosterFont,
  type PosterFormat,
  type PosterStyle,
} from '@conbert/core';
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
import { decodeSound } from '../audio-convert';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';
import { qrMatrix, QrTooLongError, type QrMatrix } from './qr-render';

const THEMES = {
  classic: { background: '#ffffff', wave: '#1b1b1f', text: '#1b1b1f' },
  night: { background: '#14213d', wave: '#fca311', text: '#f1f1f1' },
  rose: { background: '#fbeaea', wave: '#c0505a', text: '#5a2a30' },
  forest: { background: '#f3f1e7', wave: '#2f5d50', text: '#2f3a33' },
  ocean: { background: '#0b3954', wave: '#7fd1e8', text: '#e6f6fb' },
} as const;
type Theme = keyof typeof THEMES;

/** Print resolution for the PNG. */
const DPI = 300;

/** The SVG drawn into a PNG at print size. */
async function svgToPng(svg: string, format: PosterFormat): Promise<Blob> {
  const { w, h } = POSTER_FORMATS[format];
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((w / 25.4) * DPI);
    canvas.height = Math.round((h / 25.4) * DPI);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no png'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Chips<T extends string>({
  label,
  values,
  value,
  onChange,
  text,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
  text: (v: T) => string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              value === v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {text(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Klangbild – a recording's waveform as a poster. */
export function SoundPosterTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [sound, setSound] = useState<{ file: File; samples: Float32Array } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const [style, setStyle] = useState<PosterStyle>('mirror');
  const [format, setFormat] = useState<PosterFormat>('a4');
  const [theme, setTheme] = useState<Theme>('classic');
  const [colors, setColors] = useState<{ background: string; wave: string; text: string }>(
    THEMES.classic,
  );
  const [font, setFont] = useState<PosterFont>('serif');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [link, setLink] = useState('');
  const [qr, setQr] = useState<{ link: string; m: QrMatrix | null; tooLong: boolean }>({
    link: '',
    m: null,
    tooLong: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    let active = true;
    decodeSound(file)
      .then((d) => active && setSound({ file, samples: d.samples }))
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    const target = link.trim();
    if (!target) return;
    let active = true;
    qrMatrix(target, false)
      .then((m) => active && setQr({ link: target, m, tooLong: false }))
      .catch(
        (e: unknown) =>
          active && setQr({ link: target, m: null, tooLong: e instanceof QrTooLongError }),
      );
    return () => {
      active = false;
    };
  }, [link]);

  const current = sound && sound.file === file ? sound.samples : null;
  const peaks = useMemo(
    () => (current ? posterPeaks(current, posterSlices(style)) : null),
    [current, style],
  );
  const qrNow = link.trim() && qr.link === link.trim() ? qr.m : null;
  const svg = useMemo(
    () =>
      peaks
        ? soundPosterSvg(peaks, {
            style,
            format,
            font,
            title: title.trim(),
            subtitle: subtitle.trim(),
            qr: qrNow,
            ...colors,
          })
        : null,
    [peaks, style, format, font, title, subtitle, qrNow, colors],
  );
  const svgBlob = useMemo(() => (svg ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const url = useObjectUrl(svgBlob);
  const base = (title.trim() || file?.name.replace(/\.[^.]+$/, '') || 'klangbild').replace(
    /[\\/:*?"<>|]+/g,
    '_',
  );

  async function png() {
    if (!svg) return;
    setBusy(true);
    try {
      saveBlob(await svgToPng(svg, format), `${base}.png`);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const color = (key: keyof typeof colors) => (
    <div className="flex items-center gap-2">
      <input
        id={`poster-${key}`}
        type="color"
        value={colors[key]}
        onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}
        className="size-8 cursor-pointer rounded border bg-transparent"
      />
      <Label htmlFor={`poster-${key}`} className="font-normal">
        {t(`workshop.soundposter.colors.${key}`)}
      </Label>
    </div>
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="soundposter" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.soundposter.failed')}
        </p>
      )}
      {file && !current && failed !== file && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.soundposter.reading')}
        </p>
      )}
      {svg && url && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex items-start justify-center rounded-lg border bg-muted/30 p-4">
            <img
              src={url}
              alt={t('workshop.soundposter.preview')}
              className="max-h-[70vh] max-w-full shadow-lg"
            />
          </div>
          <div className="space-y-4">
            <Chips
              label={t('workshop.soundposter.style')}
              values={POSTER_STYLES}
              value={style}
              onChange={setStyle}
              text={(v) => t(`workshop.soundposter.styles.${v}`)}
            />
            <div className="space-y-1">
              <Label htmlFor="poster-format">{t('workshop.soundposter.format')}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as PosterFormat)}>
                <SelectTrigger id="poster-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(POSTER_FORMATS) as PosterFormat[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`workshop.soundposter.formats.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Chips
              label={t('workshop.soundposter.theme')}
              values={Object.keys(THEMES) as Theme[]}
              value={theme}
              onChange={(v) => {
                setTheme(v);
                setColors(THEMES[v]);
              }}
              text={(v) => t(`workshop.soundposter.themes.${v}`)}
            />
            <div className="flex flex-wrap gap-4">
              {color('background')}
              {color('wave')}
              {color('text')}
            </div>
            <div className="space-y-1">
              <Label htmlFor="poster-title">{t('workshop.soundposter.title')}</Label>
              <Input
                id="poster-title"
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="poster-subtitle">{t('workshop.soundposter.subtitle')}</Label>
              <Input
                id="poster-subtitle"
                value={subtitle}
                maxLength={80}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </div>
            <Chips
              label={t('workshop.soundposter.font')}
              values={POSTER_FONTS}
              value={font}
              onChange={setFont}
              text={(v) => t(`workshop.soundposter.fonts.${v}`)}
            />
            <div className="space-y-1">
              <Label htmlFor="poster-link">{t('workshop.soundposter.link')}</Label>
              <Input
                id="poster-link"
                value={link}
                placeholder="https://…"
                onChange={(e) => setLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {link.trim() && qr.link === link.trim() && qr.tooLong
                  ? t('workshop.soundposter.linkTooLong')
                  : t('workshop.soundposter.linkHelp')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void png()} disabled={busy}>
                {busy ? (
                  <Loader2Icon
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                {t('workshop.soundposter.png')}
              </Button>
              <Button variant="outline" onClick={() => svgBlob && saveBlob(svgBlob, `${base}.svg`)}>
                <DownloadIcon aria-hidden="true" />
                {t('workshop.soundposter.svg')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('workshop.soundposter.printTip')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
