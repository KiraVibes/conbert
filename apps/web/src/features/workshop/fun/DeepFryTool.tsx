import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { BeforeAfter, FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { outName, usePreview } from './use-preview';

interface Result {
  image: Blob;
  url: string;
}

/** Deep-Fry & JPEG-Tod: meme colours and a picture saved to death. */
export function DeepFryTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [strength, setStrength] = useState(70);
  const [generations, setGenerations] = useState(20);
  const key = file ? `${file.name}-${file.size}-${strength}-${generations}` : null;
  const { result, working, failed } = usePreview<Result>(
    key,
    async () => {
      if (!file) return null;
      const image = await funWorker().deepFry(file, strength / 100, generations);
      return { image, url: URL.createObjectURL(image) };
    },
    (old) => URL.revokeObjectURL(old.url),
    400,
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="deepfry" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FunSlider
          label={t('workshop.deepfry.strength', { value: strength })}
          labelKey="workshop.deepfry.strengthLabel"
          helpKey="workshop.deepfry.strengthHelp"
          value={strength}
          min={0}
          max={100}
          step={5}
          onChange={setStrength}
        />
        <FunSlider
          label={t('workshop.deepfry.generations', { count: generations })}
          labelKey="workshop.deepfry.generationsLabel"
          helpKey="workshop.deepfry.generationsHelp"
          value={generations}
          min={0}
          max={100}
          onChange={setGenerations}
        />
      </div>
      {file && (
        <BeforeAfter
          original={file}
          result={result?.url ?? null}
          working={working}
          failed={failed}
          failedText={t('workshop.fun.failed')}
          resultAlt={t('workshop.deepfry.resultAlt')}
        >
          {result && (
            <Button size="sm" onClick={() => saveBlob(result.image, outName(file, 'fried', 'jpg'))}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.fun.save', { ext: 'JPG' })}
            </Button>
          )}
        </BeforeAfter>
      )}
    </div>
  );
}
