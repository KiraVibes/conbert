import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  ASCII_MAX_COLUMNS,
  ASCII_MIN_COLUMNS,
  ASCII_RAMPS,
  asciiHtml,
  type AsciiArt,
  type AsciiRamp,
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
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { BeforeAfter, FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { outName, usePreview } from './use-preview';

const RAMPS = Object.keys(ASCII_RAMPS) as AsciiRamp[];

interface Result {
  art: AsciiArt;
  png: Blob;
  url: string;
}

/** ASCII-Art: a picture drawn with letters and symbols. */
export function AsciiTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState(100);
  const [ramp, setRamp] = useState<AsciiRamp>('classic');
  const [colored, setColored] = useState(false);
  const [dark, setDark] = useState(false);
  const key = file ? `${file.name}-${file.size}-${columns}-${ramp}-${colored}-${dark}` : null;
  const { result, working, failed } = usePreview<Result>(
    key,
    async () => {
      if (!file) return null;
      const worker = funWorker();
      const art = await worker.ascii(file, columns, ramp, dark);
      const png = await worker.asciiPng(art, colored, dark);
      return { art, png, url: URL.createObjectURL(png) };
    },
    (old) => URL.revokeObjectURL(old.url),
  );
  const text = result ? result.art.lines.join('\n') : '';

  return (
    <div className="space-y-4">
      <HowItWorks trick="ascii" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FunSlider
          label={t('workshop.ascii.columns', { value: columns })}
          labelKey="workshop.ascii.columnsLabel"
          helpKey="workshop.ascii.columnsHelp"
          value={columns}
          min={ASCII_MIN_COLUMNS}
          max={ASCII_MAX_COLUMNS}
          step={5}
          onChange={setColumns}
        />
        <div className="space-y-2">
          <Label htmlFor="ascii-ramp" className="flex items-center gap-1">
            {t('workshop.ascii.ramp')}
            <HelpTip helpKey="workshop.ascii.rampHelp" labelKey="workshop.ascii.ramp" />
          </Label>
          <Select value={ramp} onValueChange={(v) => setRamp(v as AsciiRamp)}>
            <SelectTrigger id="ascii-ramp" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RAMPS.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`workshop.ascii.ramps.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="ascii-colored" checked={colored} onCheckedChange={setColored} />
          <Label htmlFor="ascii-colored" className="flex items-center gap-1">
            {t('workshop.ascii.colored')}
            <HelpTip helpKey="workshop.ascii.coloredHelp" labelKey="workshop.ascii.colored" />
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="ascii-dark" checked={dark} onCheckedChange={setDark} />
          <Label htmlFor="ascii-dark" className="flex items-center gap-1">
            {t('workshop.ascii.dark')}
            <HelpTip helpKey="workshop.ascii.darkHelp" labelKey="workshop.ascii.dark" />
          </Label>
        </div>
      </div>
      {file && (
        <BeforeAfter
          original={file}
          result={result?.url ?? null}
          working={working}
          failed={failed}
          failedText={t('workshop.fun.failed')}
          resultAlt={t('workshop.ascii.resultAlt')}
        >
          {result && (
            <>
              <CopyButton text={text} label={t('workshop.ascii.copy')} />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  saveBlob(
                    new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }),
                    outName(file, 'ascii', 'txt'),
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.ascii.saveTxt')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  saveBlob(
                    new Blob([asciiHtml(result.art, colored, dark)], {
                      type: 'text/html;charset=utf-8',
                    }),
                    outName(file, 'ascii', 'html'),
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.ascii.saveHtml')}
              </Button>
              <Button size="sm" onClick={() => saveBlob(result.png, outName(file, 'ascii', 'png'))}>
                <DownloadIcon aria-hidden="true" />
                {t('workshop.ascii.savePng')}
              </Button>
            </>
          )}
        </BeforeAfter>
      )}
    </div>
  );
}
