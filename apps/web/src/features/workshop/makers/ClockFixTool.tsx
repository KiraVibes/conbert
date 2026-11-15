import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon, DownloadIcon, Loader2Icon, XIcon } from 'lucide-react';
import {
  blobReader,
  datePatches,
  findMediaDates,
  packZip,
  splitSeconds,
  type MediaDates,
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
import { Dropzone } from '@/features/convert/Dropzone';
import { cn } from '@/lib/utils';
import { HowItWorks } from '../SingleFile';
import { saveBlob } from '../save-blob';

interface Entry {
  file: File;
  dates: MediaDates;
}

const MODES = ['shift', 'reference'] as const;
type Mode = (typeof MODES)[number];
const ALL = '\u0000all';

/** The file with the dates moved: only the date bytes change, the rest is sliced through. */
function shifted(e: Entry, seconds: number): Blob {
  const patches = datePatches(e.dates.spots, seconds).sort((a, b) => a.offset - b.offset);
  const parts: BlobPart[] = [];
  let at = 0;
  for (const p of patches) {
    parts.push(e.file.slice(at, p.offset), p.bytes as Uint8Array<ArrayBuffer>);
    at = p.offset + p.bytes.length;
  }
  parts.push(e.file.slice(at));
  return new Blob(parts, { type: e.file.type });
}

/** "2024-05-01T12:34:56" from a date input → the moment, in the file's own way of counting. */
function enteredMoment(value: string, utc: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return null;
  const parts = [
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ] as const;
  return utc ? new Date(...parts) : new Date(Date.UTC(...parts));
}

/** Kamera-Uhr korrigieren – move the "taken" dates of photos and videos. */
export function ClockFixTool() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reading, setReading] = useState(0);
  const [mode, setMode] = useState<Mode>('shift');
  const [sign, setSign] = useState<1 | -1>(1);
  const [parts, setParts] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [refIndex, setRefIndex] = useState(0);
  const [refValue, setRefValue] = useState('');
  const [camera, setCamera] = useState(ALL);
  const [busy, setBusy] = useState(false);

  async function add(files: File[]) {
    setReading((n) => n + files.length);
    const read = await Promise.all(
      files.map(async (file) => {
        try {
          return { file, dates: await findMediaDates(blobReader(file)) };
        } catch {
          const none: MediaDates = {
            kind: 'none',
            taken: null,
            utc: false,
            camera: null,
            spots: [],
          };
          return { file, dates: none };
        } finally {
          setReading((n) => n - 1);
        }
      }),
    );
    setEntries((prev) => [...prev, ...read]);
  }

  const dated = entries.filter((e) => e.dates.taken);
  const cameras = useMemo(
    () => [...new Set(entries.map((e) => e.dates.camera).filter((c): c is string => !!c))].sort(),
    [entries],
  );
  const ref = dated[Math.min(refIndex, dated.length - 1)];

  // Until it's edited, the reference time is what the file says (easy to correct).
  const refDefault = (() => {
    const taken = ref?.dates.taken;
    if (!taken) return '';
    const d = ref.dates.utc ? new Date(taken.getTime() - taken.getTimezoneOffset() * 60000) : taken;
    return d.toISOString().slice(0, 19);
  })();
  const refShown = refValue || refDefault;

  const seconds = (() => {
    if (mode === 'shift')
      return sign * (parts.days * 86400 + parts.hours * 3600 + parts.minutes * 60 + parts.seconds);
    const taken = ref?.dates.taken;
    const wanted = enteredMoment(refShown, ref?.dates.utc ?? false);
    return taken && wanted ? Math.round((wanted.getTime() - taken.getTime()) / 1000) : 0;
  })();

  const applies = (e: Entry) => !!e.dates.taken && (camera === ALL || e.dates.camera === camera);
  const fmt = (d: Date, utcMoment: boolean) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      ...(utcMoment ? {} : { timeZone: 'UTC' }),
    }).format(d);
  // MP4 box times are real moments (UTC); camera texts are clock times.
  const isMoment = (e: Entry) => e.dates.utc;
  const split = splitSeconds(seconds);

  async function save() {
    const todo = entries.filter(applies);
    if (todo.length === 0) return;
    setBusy(true);
    try {
      if (todo.length === 1 && todo[0]) saveBlob(shifted(todo[0], seconds), todo[0].file.name);
      else {
        const files = await Promise.all(
          todo.map(async (e) => ({
            name: e.file.name,
            data: new Uint8Array(await shifted(e, seconds).arrayBuffer()),
          })),
        );
        saveBlob(
          new Blob([(await packZip(files)) as Uint8Array<ArrayBuffer>], {
            type: 'application/zip',
          }),
          t('workshop.clockfix.zipName'),
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const number = (key: keyof typeof parts, max: number) => (
    <div className="w-24 space-y-1">
      <Label htmlFor={`clock-${key}`}>{t(`workshop.clockfix.units.${key}`)}</Label>
      <Input
        id={`clock-${key}`}
        type="number"
        min={0}
        max={max}
        value={parts[key]}
        onChange={(e) =>
          setParts((p) => ({
            ...p,
            [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)),
          }))
        }
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="clockfix" />
      <Dropzone compact onFiles={(files) => void add(files)} />
      {reading > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.clockfix.reading')}
        </p>
      )}
      {entries.length > 0 && (
        <>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t('workshop.clockfix.mode')}
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  mode === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                {t(`workshop.clockfix.modes.${m}`)}
              </button>
            ))}
          </div>
          {mode === 'shift' ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="clock-sign">{t('workshop.clockfix.direction')}</Label>
                <Select value={String(sign)} onValueChange={(v) => setSign(v === '-1' ? -1 : 1)}>
                  <SelectTrigger id="clock-sign" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{t('workshop.clockfix.later')}</SelectItem>
                    <SelectItem value="-1">{t('workshop.clockfix.earlier')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {number('days', 3650)}
              {number('hours', 23)}
              {number('minutes', 59)}
              {number('seconds', 59)}
            </div>
          ) : dated.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="clock-ref">{t('workshop.clockfix.refFile')}</Label>
                <Select
                  value={String(Math.min(refIndex, dated.length - 1))}
                  onValueChange={(v) => {
                    setRefIndex(Number(v));
                    setRefValue('');
                  }}
                >
                  <SelectTrigger id="clock-ref" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dated.map((e, i) => (
                      <SelectItem key={`${e.file.name}-${i}`} value={String(i)}>
                        {e.file.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="clock-ref-time">{t('workshop.clockfix.refTime')}</Label>
                <Input
                  id="clock-ref-time"
                  type="datetime-local"
                  step={1}
                  value={refShown}
                  onChange={(e) => setRefValue(e.target.value)}
                  className="w-60"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('workshop.clockfix.noDates')}</p>
          )}
          {cameras.length > 1 && (
            <div className="max-w-sm space-y-1">
              <Label htmlFor="clock-camera">{t('workshop.clockfix.camera')}</Label>
              <Select value={camera} onValueChange={setCamera}>
                <SelectTrigger id="clock-camera">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('workshop.clockfix.allCameras')}</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('workshop.clockfix.cameraHelp')}</p>
            </div>
          )}
          <p className="text-sm font-medium" data-testid="clockfix-shift">
            {seconds === 0
              ? t('workshop.clockfix.noShift')
              : t(
                  split.sign > 0
                    ? 'workshop.clockfix.shiftLater'
                    : 'workshop.clockfix.shiftEarlier',
                  {
                    days: split.days,
                    hours: split.hours,
                    minutes: split.minutes,
                    seconds: split.seconds,
                  },
                )}
          </p>
          <ul className="divide-y rounded-lg border text-sm" data-testid="clockfix-list">
            {entries.map((e, i) => (
              <li
                key={`${e.file.name}-${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                <span className="min-w-0 flex-1 basis-48 truncate font-medium" title={e.file.name}>
                  {e.file.name}
                  {e.dates.camera && (
                    <span className="font-normal text-muted-foreground"> · {e.dates.camera}</span>
                  )}
                </span>
                {e.dates.taken ? (
                  <span
                    className={cn(
                      'flex items-center gap-2 tabular-nums',
                      !applies(e) && 'text-muted-foreground',
                    )}
                  >
                    {fmt(e.dates.taken, isMoment(e))}
                    {applies(e) && seconds !== 0 && (
                      <>
                        <ArrowRightIcon className="size-3.5" aria-hidden="true" />
                        <strong>
                          {fmt(new Date(e.dates.taken.getTime() + seconds * 1000), isMoment(e))}
                        </strong>
                      </>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('workshop.clockfix.noDate')}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('workshop.clockfix.remove', { name: e.file.name })}
                  onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            onClick={() => void save()}
            disabled={busy || seconds === 0 || !entries.some(applies)}
          >
            {busy ? (
              <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <DownloadIcon aria-hidden="true" />
            )}
            {t('workshop.clockfix.save', { count: entries.filter(applies).length })}
          </Button>
          <p className="text-xs text-muted-foreground">{t('workshop.clockfix.note')}</p>
        </>
      )}
    </div>
  );
}
