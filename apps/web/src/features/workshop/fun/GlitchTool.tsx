import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DicesIcon, DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { BeforeAfter, FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { outName, usePreview } from './use-preview';

interface Result {
  image: Blob;
  ext: 'jpg' | 'png';
  url: string;
}

/** Glitch-Art: a few bytes of the JPEG data are changed on purpose. */
export function GlitchTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(10);
  const [shift, setShift] = useState(0);
  const [seed, setSeed] = useState(1);
  const key = file ? `${file.name}-${file.size}-${amount}-${shift}-${seed}` : null;
  const { result, working, failed } = usePreview<Result>(
    key,
    async () => {
      if (!file) return null;
      const r = await funWorker().glitch(file, amount, seed, shift);
      return r ? { ...r, url: URL.createObjectURL(r.image) } : null;
    },
    (old) => URL.revokeObjectURL(old.url),
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="glitch" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <FunSlider
          label={t('workshop.glitch.amount', { value: amount })}
          labelKey="workshop.glitch.amountLabel"
          helpKey="workshop.glitch.amountHelp"
          value={amount}
          min={1}
          max={200}
          onChange={setAmount}
        />
        <FunSlider
          label={t('workshop.glitch.shift', { value: shift })}
          labelKey="workshop.glitch.shiftLabel"
          helpKey="workshop.glitch.shiftHelp"
          value={shift}
          min={0}
          max={40}
          onChange={setShift}
        />
        <Button variant="outline" onClick={() => setSeed((s) => s + 1)} disabled={!file}>
          <DicesIcon aria-hidden="true" />
          {t('workshop.glitch.again')}
        </Button>
      </div>
      {file && (
        <BeforeAfter
          original={file}
          result={result?.url ?? null}
          working={working}
          failed={failed}
          failedText={t('workshop.glitch.failed')}
          resultAlt={t('workshop.glitch.resultAlt')}
        >
          {result && (
            <Button
              size="sm"
              onClick={() => saveBlob(result.image, outName(file, 'glitch', result.ext))}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.fun.save', { ext: result.ext.toUpperCase() })}
            </Button>
          )}
        </BeforeAfter>
      )}
    </div>
  );
}
