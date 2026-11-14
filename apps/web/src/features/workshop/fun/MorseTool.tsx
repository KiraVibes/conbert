import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DownloadIcon,
  LightbulbIcon,
  Loader2Icon,
  MicIcon,
  PlayIcon,
  SquareIcon,
} from 'lucide-react';
import {
  decodeMorseAudio,
  floatWav,
  fromMorse,
  morseAudio,
  morseTiming,
  toMorse,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { decodeSound } from '../audio-convert';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';

const RATE = 22050;

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm',
        props.className,
      )}
    />
  );
}
const MODES = ['write', 'read', 'listen'] as const;
type Mode = (typeof MODES)[number];

/** Morse code: text ↔ dots and dashes, as sound and light, and back from a recording. */
export function MorseTool() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('write');
  return (
    <div className="space-y-4">
      <HowItWorks trick="morse" />
      <div className="flex flex-wrap gap-2" role="tablist">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              mode === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {t(`workshop.morse.modes.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'write' && <WriteMorse />}
      {mode === 'read' && <ReadMorse />}
      {mode === 'listen' && <ListenMorse />}
    </div>
  );
}

function WriteMorse() {
  const { t } = useTranslation();
  const [text, setText] = useState('SOS');
  const [wpm, setWpm] = useState(15);
  const [lit, setLit] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const stop = useRef<() => void>(() => undefined);
  const code = useMemo(() => toMorse(text), [text]);
  const wav = useMemo(
    () =>
      code
        ? new Blob([floatWav(morseAudio(code, RATE, wpm), RATE) as Uint8Array<ArrayBuffer>], {
            type: 'audio/wav',
          })
        : null,
    [code, wpm],
  );
  const url = useObjectUrl(wav);

  useEffect(() => () => stop.current(), []);

  function flash() {
    stop.current();
    const unit = 1200 / wpm;
    const timers: number[] = [];
    let at = 0;
    setFlashing(true);
    for (const step of morseTiming(code)) {
      const on = step.on;
      timers.push(window.setTimeout(() => setLit(on), at));
      at += step.units * unit;
    }
    timers.push(
      window.setTimeout(() => {
        setLit(false);
        setFlashing(false);
      }, at),
    );
    stop.current = () => {
      timers.forEach(clearTimeout);
      setLit(false);
      setFlashing(false);
    };
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="morse-text">{t('workshop.morse.text')}</Label>
      <Textarea id="morse-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      <div className="flex items-start gap-2">
        <p
          className="flex-1 rounded-lg border bg-muted/40 p-3 font-mono text-lg break-words"
          data-testid="morse-code"
        >
          {code || '–'}
        </p>
        <CopyButton text={code} label={t('workshop.morse.copy')} />
      </div>
      <div className="max-w-xs space-y-1">
        <Label>{t('workshop.morse.speed', { wpm })}</Label>
        <Slider
          min={5}
          max={30}
          step={1}
          value={[wpm]}
          onValueChange={([v]) => setWpm(v ?? 15)}
          aria-label={t('workshop.morse.speedLabel')}
        />
      </div>
      {url && <audio src={url} controls className="w-full" />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => (flashing ? stop.current() : flash())}
          disabled={!code}
        >
          {flashing ? <SquareIcon aria-hidden="true" /> : <LightbulbIcon aria-hidden="true" />}
          {flashing ? t('workshop.morse.stop') : t('workshop.morse.flash')}
        </Button>
        <span
          className={cn(
            'size-10 rounded-full border-2 transition-colors motion-reduce:transition-none',
            lit
              ? 'border-yellow-300 bg-yellow-300 shadow-[0_0_24px_rgba(253,224,71,0.9)]'
              : 'bg-muted',
          )}
          aria-hidden="true"
        />
        {wav && (
          <Button variant="outline" onClick={() => saveBlob(wav, 'morse.wav')}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.morse.download')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReadMorse() {
  const { t } = useTranslation();
  const [code, setCode] = useState('... --- ...');
  const text = useMemo(() => fromMorse(code), [code]);
  return (
    <div className="space-y-3">
      <Label htmlFor="morse-code-in">{t('workshop.morse.code')}</Label>
      <Textarea
        id="morse-code-in"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={2}
        className="font-mono"
      />
      <p className="text-xs text-muted-foreground">{t('workshop.morse.codeHint')}</p>
      <p className="rounded-lg border bg-muted/40 p-3 text-lg" data-testid="morse-text-out">
        {text || '–'}
      </p>
    </div>
  );
}

function ListenMorse() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ code: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [failed, setFailed] = useState(false);

  async function read(blob: File) {
    setBusy(true);
    setFailed(false);
    try {
      const sound = await decodeSound(blob);
      setResult(decodeMorseAudio(sound.samples, sound.sampleRate));
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(null);
        const blob = new File(parts, 'aufnahme.webm', { type: rec.mimeType });
        setFile(blob);
        void read(blob);
      };
      rec.start();
      setRecording(rec);
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('workshop.morse.listenIntro')}</p>
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setResult(null);
          if (f) void read(f);
        }}
      />
      <Button variant="outline" onClick={() => void record()}>
        {recording ? <SquareIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        {recording ? t('workshop.morse.recordStop') : t('workshop.morse.record')}
      </Button>
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.morse.listening')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.morse.failed')}
        </p>
      )}
      {result && (
        <div className="space-y-2" data-testid="morse-heard">
          <p className="rounded-lg border bg-muted/40 p-3 font-mono break-words">
            {result.code || '–'}
          </p>
          <p className="rounded-lg border p-3 text-lg">
            {result.text || t('workshop.morse.nothing')}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <PlayIcon className="mr-1 inline size-3" aria-hidden="true" />
        {t('workshop.morse.listenTip')}
      </p>
    </div>
  );
}
