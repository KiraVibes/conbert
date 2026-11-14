import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import {
  TEST_AUDIO_MAX_SECONDS,
  TEST_FILE_KINDS,
  TEST_FILLS,
  TEST_IMAGE_MAX_SIDE,
  TEST_PDF_MAX_PAGES,
  TEST_SIZE_UNITS,
  TEST_TONES,
  TEST_VIDEO_MAX_SECONDS,
  testFileName,
  testSizeBytes,
  type TestFileKind,
  type TestFill,
  type TestSizeUnit,
  type TestTone,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
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
import { formatBytes } from '@/lib/format-bytes';
import { saveBlob } from '@/lib/zip';
import { HowItWorks } from '../SingleFile';
import { sizedBlob, testImage, testPdf, testVideo, testWav } from './make-test-files';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
type ImageExt = keyof typeof IMAGE_TYPES;
const VIDEO_SIZES = { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080] } as const;
type VideoSize = keyof typeof VIDEO_SIZES;

/** A number field that only takes values inside min…max (else back to the old value). */
function NumberField({
  id,
  label,
  helpKey,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  id: string;
  label: string;
  helpKey?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: React.ReactNode;
}) {
  const [text, setText] = useState(String(value));
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
    else setText(String(value));
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {helpKey && <HelpTip helpKey={helpKey} />}
      </Label>
      <span className="flex items-center gap-1.5">
        <Input
          id={id}
          value={text}
          inputMode="decimal"
          className="w-28 tabular-nums"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(text);
          }}
        />
        {suffix}
      </span>
    </div>
  );
}

function Choice<T extends string>({
  id,
  label,
  helpKey,
  value,
  values,
  text,
  onChange,
}: {
  id: string;
  label: string;
  helpKey?: string;
  value: T;
  values: readonly T[];
  text: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {helpKey && <HelpTip helpKey={helpKey} />}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {text(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Test files: exact sizes, test picture, test tone, numbered PDF, test video. */
export function TestFilesTool() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<TestFileKind>('size');
  const [amount, setAmount] = useState(25);
  const [unit, setUnit] = useState<TestSizeUnit>('MB');
  const [fill, setFill] = useState<TestFill>('random');
  const [ext, setExt] = useState('bin');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [imageExt, setImageExt] = useState<ImageExt>('png');
  const [tone, setTone] = useState<TestTone>('beeps');
  const [seconds, setSeconds] = useState(10);
  const [pages, setPages] = useState(10);
  const [videoSize, setVideoSize] = useState<VideoSize>('720p');
  const [container, setContainer] = useState<'mp4' | 'webm'>('mp4');
  const [busy, setBusy] = useState<{ percent: number; abort: AbortController } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; size: number } | null>(null);

  const bytes = testSizeBytes(amount, unit);
  const make = async () => {
    setError(null);
    setMade(null);
    const abort = new AbortController();
    setBusy({ percent: 0, abort });
    try {
      let blob: Blob;
      let name: string;
      switch (kind) {
        case 'size':
          if (bytes === null) return;
          blob = sizedBlob(bytes, fill);
          name = testFileName(amount, unit, fill, ext);
          break;
        case 'image':
          blob = await testImage(width, height, IMAGE_TYPES[imageExt]);
          name = `test-${width}x${height}.${imageExt}`;
          break;
        case 'audio':
          blob = testWav(tone, seconds);
          name = `test-${tone}-${seconds}s.wav`;
          break;
        case 'pdf':
          blob = await testPdf(pages, t('workshop.testfiles.pdfTitle'));
          name = `test-${pages}-${t('workshop.testfiles.pagesWord')}.pdf`;
          break;
        case 'video': {
          const [w, h] = VIDEO_SIZES[videoSize];
          blob = await testVideo(
            seconds,
            w,
            h,
            container,
            (percent) => setBusy({ percent, abort }),
            abort.signal,
          );
          name = `test-${videoSize}-${seconds}s.${container}`;
          break;
        }
      }
      saveBlob(blob, name);
      setMade({ name, size: blob.size });
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('test file failed', err);
      setError(
        kind === 'video' ? t('workshop.testfiles.videoFailed') : t('workshop.testfiles.failed'),
      );
    } finally {
      setBusy(null);
    }
  };

  const maxSeconds = kind === 'video' ? TEST_VIDEO_MAX_SECONDS : TEST_AUDIO_MAX_SECONDS;

  return (
    <div className="space-y-4">
      <HowItWorks trick="testfiles" />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('workshop.testfiles.kind')}>
        {TEST_FILE_KINDS.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={kind === k ? 'default' : 'outline'}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setMade(null);
              setError(null);
            }}
          >
            {t(`workshop.testfiles.kinds.${k}.title`)}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t(`workshop.testfiles.kinds.${kind}.help`)}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {kind === 'size' && (
          <>
            <NumberField
              id="test-size"
              label={t('workshop.testfiles.size')}
              value={amount}
              min={0.001}
              max={4096}
              onChange={setAmount}
              suffix={
                <Select value={unit} onValueChange={(v) => setUnit(v as TestSizeUnit)}>
                  <SelectTrigger className="w-20" aria-label={t('workshop.testfiles.unit')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEST_SIZE_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <Choice
              id="test-fill"
              label={t('workshop.testfiles.fill')}
              helpKey="workshop.testfiles.fillHelp"
              value={fill}
              values={TEST_FILLS}
              text={(f) => t(`workshop.testfiles.fills.${f}`)}
              onChange={setFill}
            />
            <div className="space-y-2">
              <Label htmlFor="test-ext" className="flex items-center gap-1">
                {t('workshop.testfiles.ext')}
                <HelpTip
                  helpKey="workshop.testfiles.extHelp"
                  labelKey="workshop.testfiles.ext"
                />
              </Label>
              <Input
                id="test-ext"
                value={ext}
                maxLength={10}
                className="w-28"
                onChange={(e) => setExt(e.target.value.replace(/[^a-z0-9]/gi, '').toLowerCase())}
              />
            </div>
          </>
        )}
        {kind === 'image' && (
          <>
            <NumberField
              id="test-width"
              label={t('workshop.testfiles.width')}
              value={width}
              min={16}
              max={TEST_IMAGE_MAX_SIDE}
              onChange={(v) => setWidth(Math.round(v))}
              suffix={<span className="text-sm text-muted-foreground">px</span>}
            />
            <NumberField
              id="test-height"
              label={t('workshop.testfiles.height')}
              value={height}
              min={16}
              max={TEST_IMAGE_MAX_SIDE}
              onChange={(v) => setHeight(Math.round(v))}
              suffix={<span className="text-sm text-muted-foreground">px</span>}
            />
            <Choice
              id="test-image-format"
              label={t('workshop.testfiles.format')}
              value={imageExt}
              values={Object.keys(IMAGE_TYPES) as ImageExt[]}
              text={(e) => e.toUpperCase()}
              onChange={setImageExt}
            />
          </>
        )}
        {kind === 'audio' && (
          <Choice
            id="test-tone"
            label={t('workshop.testfiles.tone')}
            value={tone}
            values={TEST_TONES}
            text={(v) => t(`workshop.testfiles.tones.${v}`)}
            onChange={setTone}
          />
        )}
        {(kind === 'audio' || kind === 'video') && (
          <NumberField
            key={kind}
            id="test-seconds"
            label={t('workshop.testfiles.seconds')}
            value={Math.min(seconds, maxSeconds)}
            min={1}
            max={maxSeconds}
            onChange={(v) => setSeconds(Math.round(v))}
            suffix={<span className="text-sm text-muted-foreground">s</span>}
          />
        )}
        {kind === 'video' && (
          <>
            <Choice
              id="test-video-size"
              label={t('workshop.testfiles.resolution')}
              value={videoSize}
              values={Object.keys(VIDEO_SIZES) as VideoSize[]}
              text={(v) => v}
              onChange={setVideoSize}
            />
            <Choice
              id="test-video-format"
              label={t('workshop.testfiles.format')}
              value={container}
              values={['mp4', 'webm'] as const}
              text={(v) => v.toUpperCase()}
              onChange={setContainer}
            />
          </>
        )}
        {kind === 'pdf' && (
          <NumberField
            id="test-pages"
            label={t('workshop.testfiles.pages')}
            value={pages}
            min={1}
            max={TEST_PDF_MAX_PAGES}
            onChange={(v) => setPages(Math.round(v))}
          />
        )}
      </div>

      {kind === 'size' && bytes === null && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.testfiles.tooBig')}
        </p>
      )}
      {kind === 'size' && bytes !== null && (
        <p className="text-sm text-muted-foreground">
          {t('workshop.testfiles.exact', {
            bytes: bytes.toLocaleString(i18n.language),
          })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void make()} disabled={busy !== null || (kind === 'size' && !bytes)}>
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          {busy && kind === 'video'
            ? t('workshop.testfiles.making', { percent: busy.percent })
            : t('workshop.testfiles.make')}
        </Button>
        {busy && kind === 'video' && (
          <Button variant="outline" onClick={() => busy.abort.abort()}>
            <SquareIcon aria-hidden="true" />
            {t('workshop.testfiles.stop')}
          </Button>
        )}
      </div>
      {made && (
        <p role="status" className="text-sm">
          {t('workshop.testfiles.done', {
            name: made.name,
            size: formatBytes(made.size, i18n.language),
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
