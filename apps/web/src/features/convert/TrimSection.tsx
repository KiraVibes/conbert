import { useEffect, useRef, useState } from 'react';
import { CameraIcon, ChevronDownIcon, PlayIcon, ScissorsIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Slider as SliderPrimitive } from 'radix-ui';
import {
  VIDEO_TARGETS,
  formatTimecode,
  getFormat,
  normalizeExt,
  parseTimecode,
  readTrim,
  type TargetOption,
  type Trim,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveBlob } from '@/lib/zip';
import { useFiles, type FileItem } from './files-store';

function TimeField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | null;
  placeholder?: string;
  disabled?: boolean | undefined;
  onCommit: (seconds: number | null) => void;
}) {
  const { t } = useTranslation();
  // The parent remounts the field (key) when the time changes elsewhere.
  const [text, setText] = useState(value === null ? '' : formatTimecode(value));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (text.trim() === '') {
      onCommit(null);
      return;
    }
    const seconds = parseTimecode(text);
    setInvalid(seconds === null);
    if (seconds !== null) onCommit(seconds);
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="w-28 tabular-nums"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {invalid && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {t('trim.invalidTime')}
        </p>
      )}
    </div>
  );
}

/**
 * "Schneiden": keep only a part of a video or song. The part is stored as
 * options, so it works on this device and on the server alike.
 */
export function TrimSection({
  item: given,
  targets,
  disabled,
}: {
  item: FileItem;
  targets: readonly TargetOption[];
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation();
  // Always the current state of the file, even if the card is a step behind.
  const item = useFiles((s) => s.files.find((f) => f.id === given.id)) ?? given;
  const setTrim = useFiles((s) => s.setTrim);
  const setTarget = useFiles((s) => s.setTarget);
  const setOption = useFiles((s) => s.setOption);
  const trim = readTrim(item.options);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playable, setPlayable] = useState(true);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const isVideo = getFormat(item.ext)?.category === 'video';
  const sameFormat =
    item.targetExt !== null && normalizeExt(item.targetExt) === normalizeExt(item.ext);
  const id = `trim-${item.id}`;

  // The player only exists while the section is open.
  useEffect(() => {
    if (!open) return;
    const next = URL.createObjectURL(item.file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must live exactly as long as the open section
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [open, item.file]);

  // Cutting without a target yet: keep the format – that's what "cut" means.
  useEffect(() => {
    if (trim && item.targetExt === null && targets.some((x) => x.ext === normalizeExt(item.ext))) {
      setTarget(item.id, normalizeExt(item.ext));
    }
  }, [trim, item.targetExt, item.ext, item.id, targets, setTarget]);

  const start = trim?.start ?? 0;
  const end = trim?.end ?? null;
  const update = (next: Partial<Trim>) => {
    const merged: Trim = { start, end, fast: trim?.fast ?? false, ...next };
    // An end at (or after) the last moment means "to the end".
    if (merged.end !== null && duration !== null && merged.end >= duration - 0.05)
      merged.end = null;
    setTrim(item.id, merged.start <= 0 && merged.end === null ? null : merged);
  };
  const seek = (seconds: number) => {
    if (media.current) media.current.currentTime = seconds;
  };
  const current = () => media.current?.currentTime ?? 0;

  const playPart = () => {
    const el = media.current;
    if (!el) return;
    el.currentTime = start;
    stopAt.current = end;
    void el.play();
  };

  const saveStill = async () => {
    const video = media.current;
    if (!video || !video.videoWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('canvas.toBlob returned nothing');
      const base = item.name.replace(/\.[^.]+$/, '');
      const at = formatTimecode(video.currentTime).replace(/[:.]/g, '-');
      saveBlob(blob, `${base}-${at}.png`);
    } catch (error) {
      console.error('still frame failed', error);
      toast.error(t('trim.still.failed'));
    }
  };

  const length = (end ?? duration ?? 0) - start;
  const summary = trim
    ? t('trim.summary', {
        from: formatTimecode(start),
        to: end === null ? t('trim.toEnd') : formatTimecode(end),
        length: end !== null || duration !== null ? formatTimecode(Math.max(0, length)) : '?',
      })
    : null;
  const showRemoveAudio =
    isVideo && item.targetExt !== null && VIDEO_TARGETS.includes(normalizeExt(item.targetExt));

  return (
    <div className="rounded-lg border" data-testid="trim-section">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
        >
          <ScissorsIcon aria-hidden="true" />
          {t('trim.title')}
          <ChevronDownIcon
            aria-hidden="true"
            className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </Button>
        {summary ? (
          <>
            <span className="text-sm tabular-nums" data-testid="trim-summary">
              {summary}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={disabled}
              onClick={() => setTrim(item.id, null)}
              aria-label={t('trim.reset')}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t('trim.teaser')}</span>
        )}
      </div>

      {open && (
        <div id={`${id}-panel`} className="space-y-4 border-t p-3">
          <p className="text-sm text-muted-foreground">{t('trim.intro')}</p>
          {url &&
            (isVideo ? (
              <video
                ref={media}
                src={url}
                controls
                preload="metadata"
                className="max-h-72 w-full rounded-md bg-black"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  setDuration(Number.isFinite(d) ? d : null);
                }}
                onTimeUpdate={(e) => {
                  if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                    e.currentTarget.pause();
                    stopAt.current = null;
                  }
                }}
                onError={() => setPlayable(false)}
              />
            ) : (
              <audio
                ref={media}
                src={url}
                controls
                preload="metadata"
                className="w-full"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  setDuration(Number.isFinite(d) ? d : null);
                }}
                onTimeUpdate={(e) => {
                  if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                    e.currentTarget.pause();
                    stopAt.current = null;
                  }
                }}
                onError={() => setPlayable(false)}
              />
            ))}
          {!playable && <p className="text-sm text-muted-foreground">{t('trim.notPlayable')}</p>}

          {duration !== null && (
            <SliderPrimitive.Root
              className="relative flex h-6 w-full touch-none items-center select-none"
              min={0}
              max={duration}
              step={0.1}
              minStepsBetweenThumbs={1}
              value={[start, end ?? duration]}
              disabled={disabled}
              onValueChange={([a = 0, b = duration]) => {
                if (a !== start) seek(a);
                else if (b !== (end ?? duration)) seek(b);
                update({ start: a, end: b });
              }}
            >
              <SliderPrimitive.Track className="relative h-2 grow overflow-hidden rounded-full bg-muted">
                <SliderPrimitive.Range className="absolute h-full bg-primary" />
              </SliderPrimitive.Track>
              {(
                [
                  [t('trim.start'), start],
                  [t('trim.end'), end ?? duration],
                ] as const
              ).map(([label, value]) => (
                <SliderPrimitive.Thumb
                  key={label}
                  aria-label={label}
                  aria-valuetext={formatTimecode(value)}
                  className="block size-4 rounded-full border-2 border-primary bg-background shadow focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
                />
              ))}
            </SliderPrimitive.Root>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <TimeField
              key={`start-${start}`}
              id={`${id}-start`}
              label={t('trim.start')}
              value={start}
              disabled={disabled}
              onCommit={(s) => update({ start: s ?? 0 })}
            />
            <TimeField
              key={`end-${end ?? ''}`}
              id={`${id}-end`}
              label={t('trim.end')}
              value={end}
              placeholder={duration !== null ? formatTimecode(duration) : t('trim.toEnd')}
              disabled={disabled}
              onCommit={(s) => update({ end: s })}
            />
            <p className="pb-2 text-xs text-muted-foreground">{t('trim.timeHint')}</p>
          </div>

          {playable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => update({ start: current() })}
              >
                {t('trim.startHere')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => update({ end: current() })}
              >
                {t('trim.endHere')}
              </Button>
              <Button size="sm" variant="ghost" onClick={playPart}>
                <PlayIcon aria-hidden="true" />
                {t('trim.playPart')}
              </Button>
              {isVideo && (
                <Button size="sm" variant="ghost" onClick={() => void saveStill()}>
                  <CameraIcon aria-hidden="true" />
                  {t('trim.still.button')}
                </Button>
              )}
              {isVideo && <HelpTip helpKey="trim.still.help" labelKey="trim.still.button" />}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Switch
                id={`${id}-fast`}
                checked={trim?.fast === true && sameFormat}
                disabled={disabled || !trim || !sameFormat}
                onCheckedChange={(fast) => update({ fast })}
              />
              <Label htmlFor={`${id}-fast`}>{t('trim.fast.label')}</Label>
              <HelpTip
                helpKey="trim.fast.help"
                effectKey="trim.fast.effect"
                labelKey="trim.fast.label"
              />
            </div>
            {!sameFormat && (
              <p className="text-xs text-muted-foreground">{t('trim.fast.onlySame')}</p>
            )}
          </div>

          {showRemoveAudio && (
            <div className="flex items-center gap-2">
              <Switch
                id={`${id}-mute`}
                checked={item.options['removeAudio'] === true}
                disabled={disabled}
                onCheckedChange={(on) => setOption(item.id, 'removeAudio', on)}
              />
              <Label htmlFor={`${id}-mute`}>{t('options.removeAudio.label')}</Label>
              <HelpTip helpKey="options.removeAudio.help" labelKey="options.removeAudio.label" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
