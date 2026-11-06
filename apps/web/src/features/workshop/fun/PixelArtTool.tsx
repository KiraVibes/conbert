import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  DITHERS,
  PIXEL_MAX_WIDTH,
  PIXEL_MIN_WIDTH,
  RETRO_PALETTE_IDS,
  RETRO_PALETTES,
  type Dither,
  type RetroPalette,
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
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { BeforeAfter, FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { outName, usePreview } from './use-preview';

interface Result {
  url: string;
  small: Blob;
  large: Blob;
  width: number;
  height: number;
  scale: number;
}

/** Pixel-Art-Konverter: a picture in the colours of old consoles. */
export function PixelArtTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState(96);
  const [palette, setPalette] = useState<RetroPalette>('gameboy');
  const [dither, setDither] = useState<Dither>('floyd');
  const key = file ? `${file.name}-${file.size}-${width}-${palette}-${dither}` : null;
  const { result, working, failed } = usePreview<Result>(
    key,
    async () => {
      if (!file) return null;
      const r = await funWorker().pixelArt(file, width, palette, dither);
      return { ...r, url: URL.createObjectURL(r.large) };
    },
    (old) => URL.revokeObjectURL(old.url),
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="pixelart" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FunSlider
          label={t('workshop.pixelart.width', { value: width })}
          labelKey="workshop.pixelart.widthLabel"
          helpKey="workshop.pixelart.widthHelp"
          value={width}
          min={PIXEL_MIN_WIDTH}
          max={PIXEL_MAX_WIDTH}
          step={4}
          onChange={setWidth}
        />
        <div className="space-y-2">
          <Label htmlFor="pixel-palette" className="flex items-center gap-1">
            {t('workshop.pixelart.palette')}
            <HelpTip helpKey="workshop.pixelart.paletteHelp" labelKey="workshop.pixelart.palette" />
          </Label>
          <Select value={palette} onValueChange={(v) => setPalette(v as RetroPalette)}>
            <SelectTrigger id="pixel-palette" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETRO_PALETTE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  <span className="flex items-center gap-2">
                    <span className="flex" aria-hidden="true">
                      {RETRO_PALETTES[id].slice(0, 8).map((c) => (
                        <span key={c} className="size-3" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    {t(`workshop.pixelart.palettes.${id}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pixel-dither" className="flex items-center gap-1">
            {t('workshop.pixelart.dither')}
            <HelpTip helpKey="workshop.pixelart.ditherHelp" labelKey="workshop.pixelart.dither" />
          </Label>
          <Select value={dither} onValueChange={(v) => setDither(v as Dither)}>
            <SelectTrigger id="pixel-dither" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DITHERS.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`workshop.pixelart.dithers.${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {file && (
        <BeforeAfter
          original={file}
          result={result?.url ?? null}
          working={working}
          failed={failed}
          failedText={t('workshop.fun.failed')}
          resultAlt={t('workshop.pixelart.resultAlt')}
          pixelated
        >
          {result && (
            <>
              <Button
                size="sm"
                onClick={() => saveBlob(result.large, outName(file, 'pixel', 'png'))}
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.pixelart.saveLarge', {
                  width: result.width * result.scale,
                  height: result.height * result.scale,
                })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveBlob(result.small, outName(file, 'pixel-small', 'png'))}
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.pixelart.saveSmall', { width: result.width, height: result.height })}
              </Button>
            </>
          )}
        </BeforeAfter>
      )}
    </div>
  );
}
