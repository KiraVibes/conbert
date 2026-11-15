import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DownloadIcon,
  LightbulbIcon,
  Loader2Icon,
  MicIcon,
  ArrowRightIcon,
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
  WHISPER_LANGUAGES,
  type MorseHeard,
  type WhisperLanguage,
} from '@conbert/core';
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
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { decodeSound } from '../audio-convert';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';
import { useSpeechAvailable } from '../audio-video/lyrics';

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
const MODES = ['write', 'read', 'listen', 'speak'] as const;

/** "morse-guten-morgen.wav": the first words of the text in the file name. */
function morseFileName(text: string): string {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return words ? `morse-${words}.wav` : 'morse.wav';
}
type Mode = (typeof MODES)[number];

/** Morse code: text ↔ dots and dashes, as sound and light, and back from a recording. */
export function MorseTool() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('write');
  // The text of "Text → Morse" – spoken words can be carried over into it.
  const [text, setText] = useState('SOS');
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
      {/* All three stay on the page (only hidden): a sound playing in "Text →
          Morse" or a running recording keeps going while switching tabs. */}
      <div hidden={mode !== 'write'}>
        <WriteMorse text={text} setText={setText} />
      </div>
      <div hidden={mode !== 'read'}>
        <ReadMorse />
      </div>
      <div hidden={mode !== 'listen'}>
        <ListenMorse />
      </div>
      <div hidden={mode !== 'speak'}>
        <SpeakMorse
          onUse={(spoken) => {
            setText(spoken);
            setMode('write');
          }}
        />
      </div>
    </div>
  );
}

function WriteMorse({ text, setText }: { text: string; setText: (t: string) => void }) {
  const { t } = useTranslation();
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
      {wav && (
        <Button variant="outline" onClick={() => saveBlob(wav, morseFileName(text))}>
          <DownloadIcon aria-hidden="true" />
          {t('workshop.morse.download')}
        </Button>
      )}
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
  const { t, i18n } = useTranslation();
  const secs = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<(MorseHeard & { seconds: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [failed, setFailed] = useState(false);

  async function read(blob: File) {
    setBusy(true);
    setFailed(false);
    try {
      const sound = await decodeSound(blob);
      setResult({
        ...decodeMorseAudio(sound.samples, sound.sampleRate),
        seconds: sound.samples.length / sound.sampleRate,
      });
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
      // Speech filters (noise suppression, echo cancelling, automatic volume)
      // treat a steady beep as noise and fade it out – switch them off.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
      });
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
          {result.notMorse && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {t('workshop.morse.notMorse')}
            </p>
          )}
          <p className="rounded-lg border bg-muted/40 p-3 font-mono break-words">
            {result.code || '–'}
          </p>
          <p className="rounded-lg border p-3 text-lg">
            {result.text || t('workshop.morse.nothing')}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="morse-stats">
            {result.tones > 0 && !result.notMorse
              ? t('workshop.morse.heard', {
                  seconds: secs(result.seconds),
                  pitch: result.pitch,
                  tones: result.tones,
                  ms: Math.round(result.unitMs),
                })
              : result.notMorse
                ? t('workshop.morse.heardNotMorse', {
                    seconds: secs(result.seconds),
                    pitch: result.pitch,
                  })
                : t('workshop.morse.heardNothing', { seconds: secs(result.seconds) })}
          </p>
          {result.tones > 0 && result.tones <= 4 && !result.notMorse && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t('workshop.morse.fewTones')}
            </p>
          )}
          {file && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                saveBlob(file, `morse-aufnahme.${file.name.split('.').pop() ?? 'webm'}`)
              }
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.morse.saveRecording')}
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <PlayIcon className="mr-1 inline size-3" aria-hidden="true" />
        {t('workshop.morse.listenTip')}
      </p>
    </div>
  );
}

/** Sprache → Morse: speak (or upload a recording), Whisper writes it down, Conbert morses it. */
function SpeakMorse({ onUse }: { onUse: (text: string) => void }) {
  const { t } = useTranslation();
  const available = useSpeechAvailable();
  const [language, setLanguage] = useState<WhisperLanguage>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [spoken, setSpoken] = useState<string | null>(null);
  const code = useMemo(() => (spoken ? toMorse(spoken) : ''), [spoken]);
  const wav = useMemo(
    () =>
      code
        ? new Blob([floatWav(morseAudio(code, RATE, 15), RATE) as Uint8Array<ArrayBuffer>], {
            type: 'audio/wav',
          })
        : null,
    [code],
  );
  const url = useObjectUrl(wav);

  async function recognise(f: File) {
    setBusy(true);
    setFailed(false);
    setSpoken(null);
    try {
      const out = await convertOnServer({
        file: f,
        fileName: f.name,
        outputExt: 'txt',
        options: { speechLanguage: language },
      });
      setSpoken((await out.text()).replace(/\s+/g, ' ').trim());
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
      // For speech the browser's speech filters help – they stay on here.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(null);
        const ext = rec.mimeType.includes('ogg')
          ? 'ogg'
          : rec.mimeType.includes('mp4')
            ? 'm4a'
            : 'webm';
        const f = new File(parts, `sprache.${ext}`, { type: rec.mimeType });
        setFile(f);
        void recognise(f);
      };
      rec.start();
      setRecording(rec);
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }

  if (!available) {
    return <p className="rounded-lg border p-3 text-sm">{t('workshop.morse.speakUnavailable')}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('workshop.morse.speakIntro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="morse-speak-language">{t('options.speechLanguage.label')}</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as WhisperLanguage)}>
            <SelectTrigger id="morse-speak-language" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHISPER_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`options.speechLanguage.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void record()} disabled={busy}>
          {recording ? <SquareIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
          {recording ? t('workshop.morse.speakStop') : t('workshop.morse.speakRecord')}
        </Button>
      </div>
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          if (f) void recognise(f);
        }}
      />
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.morse.speakWorking')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.morse.speakFailed')}
        </p>
      )}
      {spoken !== null && !busy && (
        <div className="space-y-2" data-testid="morse-spoken">
          <p className="rounded-lg border p-3 text-lg">
            {spoken || t('workshop.morse.speakNothing')}
          </p>
          {code && (
            <>
              <div className="flex items-start gap-2">
                <p className="flex-1 rounded-lg border bg-muted/40 p-3 font-mono break-words">
                  {code}
                </p>
                <CopyButton text={code} label={t('workshop.morse.copy')} />
              </div>
              {url && <audio src={url} controls className="w-full" />}
              <div className="flex flex-wrap gap-2">
                {wav && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveBlob(wav, morseFileName(spoken))}
                  >
                    <DownloadIcon aria-hidden="true" />
                    {t('workshop.morse.download')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onUse(spoken)}>
                  <ArrowRightIcon aria-hidden="true" />
                  {t('workshop.morse.speakUse')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
