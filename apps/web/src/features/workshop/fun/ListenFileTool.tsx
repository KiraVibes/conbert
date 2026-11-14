import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import { bytesToWav } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';
import { useFileJob } from '../forensics/use-file-job';

const RATES = [8000, 11025, 22050, 44100];
/** At most this much of a file becomes sound (at 8 kHz: about 40 minutes). */
const MAX_BYTES = 20 * 1024 * 1024;

/** Datei anhören – every byte of a file as one sound sample. */
export function ListenFileTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [rate, setRate] = useState(8000);
  const { result } = useFileJob(file, String(rate), async (f) => {
    const bytes = new Uint8Array(await f.slice(0, MAX_BYTES).arrayBuffer());
    return new Blob([bytesToWav(bytes, rate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  });
  const url = useObjectUrl(result);
  const seconds = useMemo(() => (file ? Math.min(file.size, MAX_BYTES) / rate : 0), [file, rate]);

  return (
    <div className="space-y-4">
      <HowItWorks trick="listen" />
      <SingleFile file={file} onFile={setFile} />
      <div className="max-w-xs space-y-1">
        <Label htmlFor="listen-rate">{t('workshop.listen.rate')}</Label>
        <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
          <SelectTrigger id="listen-rate" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RATES.map((r) => (
              <SelectItem key={r} value={String(r)}>
                {t(`workshop.listen.rates.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {file && url && result && (
        <div className="space-y-2" data-testid="listen-result">
          <audio src={url} controls className="w-full" />
          <p className="text-xs text-muted-foreground">
            {t('workshop.listen.length', { seconds: Math.round(seconds) })}
            {file.size > MAX_BYTES && ` ${t('workshop.listen.cut')}`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveBlob(result, `${file.name.replace(/\.[^.]+$/, '')}-sound.wav`)}
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.listen.download')}
          </Button>
        </div>
      )}
    </div>
  );
}
