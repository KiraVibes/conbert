import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  EMOJI_SET_IDS,
  MOSAIC_MAX_COLUMNS,
  MOSAIC_MIN_COLUMNS,
  emojisOf,
  type EmojiSet,
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
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { BeforeAfter, FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { outName, revoke, usePreview } from './use-preview';

const BACKGROUNDS = ['white', 'black', 'none'] as const;
type Background = (typeof BACKGROUNDS)[number];

interface Result {
  url: string;
  image: Blob;
  text: string;
  columns: number;
  rows: number;
}

/** Emoji-Mosaik: a picture rebuilt from emojis. */
export function EmojiMosaicTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState(40);
  const [set, setSet] = useState<EmojiSet>('colors');
  const [background, setBackground] = useState<Background>('white');
  const key = file ? `${file.name}-${file.size}-${columns}-${set}-${background}` : null;
  const { result, working, failed } = usePreview<Result>(
    key,
    async () => {
      if (!file) return null;
      const r = await funWorker().emojiMosaic(file, columns, set, background);
      return { ...r, url: URL.createObjectURL(r.image) };
    },
    revoke,
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="emojimosaic" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FunSlider
          label={t('workshop.emojimosaic.columns', { value: columns })}
          labelKey="workshop.emojimosaic.columnsLabel"
          helpKey="workshop.emojimosaic.columnsHelp"
          value={columns}
          min={MOSAIC_MIN_COLUMNS}
          max={MOSAIC_MAX_COLUMNS}
          step={2}
          onChange={setColumns}
        />
        <div className="space-y-2">
          <Label htmlFor="mosaic-set" className="flex items-center gap-1">
            {t('workshop.emojimosaic.set')}
            <HelpTip helpKey="workshop.emojimosaic.setHelp" labelKey="workshop.emojimosaic.set" />
          </Label>
          <Select value={set} onValueChange={(v) => setSet(v as EmojiSet)}>
            <SelectTrigger id="mosaic-set" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMOJI_SET_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  <span aria-hidden="true">{emojisOf(id).slice(0, 4).join('')}</span>
                  {t(`workshop.emojimosaic.sets.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mosaic-bg" className="flex items-center gap-1">
            {t('workshop.emojimosaic.background')}
            <HelpTip
              helpKey="workshop.emojimosaic.backgroundHelp"
              labelKey="workshop.emojimosaic.background"
            />
          </Label>
          <Select value={background} onValueChange={(v) => setBackground(v as Background)}>
            <SelectTrigger id="mosaic-bg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKGROUNDS.map((b) => (
                <SelectItem key={b} value={b}>
                  {t(`workshop.emojimosaic.backgrounds.${b}`)}
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
          resultAlt={t('workshop.emojimosaic.resultAlt')}
        >
          {result && (
            <>
              <Button
                size="sm"
                onClick={() => saveBlob(result.image, outName(file, 'emoji', 'png'))}
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.fun.save', { ext: 'PNG' })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  saveBlob(
                    new Blob([result.text], { type: 'text/plain;charset=utf-8' }),
                    outName(file, 'emoji', 'txt'),
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.emojimosaic.saveText')}
              </Button>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <CopyButton text={result.text} label={t('workshop.emojimosaic.copy')} />
                {t('workshop.emojimosaic.size', {
                  columns: result.columns,
                  rows: result.rows,
                  count: result.columns * result.rows,
                })}
              </span>
            </>
          )}
        </BeforeAfter>
      )}
      {result && result.columns <= 40 && (
        <p className="text-xs text-muted-foreground">{t('workshop.emojimosaic.chatHint')}</p>
      )}
    </div>
  );
}
