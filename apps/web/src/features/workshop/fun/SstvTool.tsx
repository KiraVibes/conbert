import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import { DownloadIcon, Loader2Icon, MicIcon, RadioTowerIcon, SquareIcon } from 'lucide-react';
import { SSTV_MODES, sstvDuration, type SstvMode, type SstvPicture } from '@conbert/core';
import { Button } from '@/components/ui/button';
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
import { withForensics } from '../forensics/forensics-worker';

function ModeSelect({
  value,
  onChange,
  id,
}: {
  value: SstvMode;
  onChange: (m: SstvMode) => void;
  id: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-xs space-y-1">
      <Label htmlFor={id}>{t('workshop.sstv.mode')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as SstvMode)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SSTV_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {t(`workshop.sstv.modes.${m}`, { seconds: Math.round(sstvDuration(m)) })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Send() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SstvMode>('robot36');
  const [wav, setWav] = useState<{ blob: Blob; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = file ? `${file.name}|${file.size}|${mode}` : '';
  const current = wav?.key === key ? wav.blob : null;
  const url = useObjectUrl(current);

  async function make() {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      const bytes = await withForensics((api) => api.sstvSend(file, mode));
      setWav({ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), key });
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <SingleFile file={file} onFile={setFile} />
      <ModeSelect id="sstv-send-mode" value={mode} onChange={setMode} />
      <Button onClick={() => void make()} disabled={!file || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <RadioTowerIcon aria-hidden="true" />
        )}
        {t('workshop.sstv.make')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.sstv.sendFailed')}
        </p>
      )}
      {current && url && (
        <div className="space-y-2" data-testid="sstv-sound">
          <audio src={url} controls className="w-full" />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              saveBlob(current, `${file?.name.replace(/\.[^.]+$/, '') ?? 'bild'}-sstv.wav`)
            }
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.sstv.download')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('workshop.sstv.sendTip')}</p>
        </div>
      )}
    </div>
  );
}

function Receive() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SstvMode>('robot36');
  const [picture, setPicture] = useState<SstvPicture | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !picture) return;
    c.width = picture.width;
    c.height = picture.height;
    c.getContext('2d')?.putImageData(
      new ImageData(picture.pixels, picture.width, picture.height),
      0,
      0,
    );
  }, [picture]);

  async function read(f: File) {
    setBusy(true);
    setFailed(false);
    setPicture(null);
    try {
      const sound = await decodeSound(f);
      const samples = sound.samples;
      const p = await withForensics((api) =>
        api.sstvReceive(Comlink.transfer(samples, [samples.buffer]), sound.sampleRate, mode),
      );
      if (p) setPicture(p);
      else setFailed(true);
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
        const f = new File(parts, 'sstv.webm', { type: rec.mimeType });
        setFile(f);
        void read(f);
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
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          if (f) void read(f);
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <ModeSelect id="sstv-receive-mode" value={mode} onChange={setMode} />
        <Button variant="outline" onClick={() => void record()}>
          {recording ? <SquareIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
          {recording ? t('workshop.sstv.recordStop') : t('workshop.sstv.record')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('workshop.sstv.modeHint')}</p>
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.sstv.decoding')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.sstv.receiveFailed')}
        </p>
      )}
      {picture && (
        <div className="space-y-2" data-testid="sstv-picture">
          <p className="text-sm">
            {picture.vis
              ? t('workshop.sstv.found', {
                  mode: t(`workshop.sstv.modes.${picture.mode}`, {
                    seconds: Math.round(sstvDuration(picture.mode)),
                  }),
                })
              : t('workshop.sstv.noHeader')}
          </p>
          <canvas
            ref={canvas}
            className="w-full max-w-lg rounded border [image-rendering:pixelated]"
            aria-label={t('workshop.sstv.pictureAlt')}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              canvas.current?.toBlob((b) => {
                if (b) saveBlob(b, 'sstv.png');
              }, 'image/png')
            }
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.sstv.savePicture')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** SSTV – pictures as sound, like radio amateurs and the ISS send them. */
export function SstvTool() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'send' | 'receive'>('send');
  return (
    <div className="space-y-4">
      <HowItWorks trick="sstv" />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['send', 'receive'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={tab === m}
            onClick={() => setTab(m)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              tab === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {t(`workshop.sstv.tabs.${m}`)}
          </button>
        ))}
      </div>
      {tab === 'send' ? <Send /> : <Receive />}
    </div>
  );
}
