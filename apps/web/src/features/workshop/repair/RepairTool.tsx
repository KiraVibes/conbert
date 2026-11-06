import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheckIcon, DownloadIcon, Loader2Icon, WrenchIcon } from 'lucide-react';
import type { RepairFix } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { detectFileType } from '@/lib/detect-type';
import { formatBytes } from '@/lib/format-bytes';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { inspectWorker } from '../workshop-worker';

interface Outcome {
  file: File;
  fixes: RepairFix[];
  repaired: Blob | null;
  name: string;
}

/** Datei-Reparatur: checksums, cut-off pictures, data behind the end, wrong extension. */
export function RepairTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [cutAppended, setCutAppended] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const shown = outcome && outcome.file === file ? outcome : null;

  const run = async (f: File) => {
    setBusy(true);
    try {
      const { detectedExt } = await detectFileType(f);
      const r = await inspectWorker.repair(f, f.name, detectedExt, cutAppended);
      setOutcome({ file: f, fixes: r.fixes, repaired: r.file, name: r.name });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="repair" />
      <SingleFile file={file} onFile={setFile} />
      <div className="flex items-start gap-2">
        <Switch id="repair-cut" checked={cutAppended} onCheckedChange={setCutAppended} />
        <Label htmlFor="repair-cut" className="flex items-center gap-1">
          {t('workshop.repair.cutAppended')}
          <HelpTip
            helpKey="workshop.repair.cutAppendedHelp"
            labelKey="workshop.repair.cutAppended"
          />
        </Label>
      </div>
      <Button onClick={() => file && void run(file)} disabled={!file || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <WrenchIcon aria-hidden="true" />
        )}
        {t('workshop.repair.run')}
      </Button>

      {shown && shown.fixes.length === 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4"
        >
          <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          {t('workshop.repair.nothing')}
        </p>
      )}
      {shown && shown.fixes.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-medium">{t('workshop.repair.whatWasWrong')}</h3>
          <ul className="space-y-2">
            {shown.fixes.map((fix) => (
              <li key={fix.kind} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {t(`workshop.repair.fixes.${fix.kind}.title`, {
                    count: fix.count ?? 0,
                    size: formatBytes(fix.count ?? 0, i18n.language),
                    name: fix.name ?? '',
                  })}
                </p>
                <p className="text-muted-foreground">
                  {t(`workshop.repair.fixes.${fix.kind}.help`)}
                </p>
              </li>
            ))}
          </ul>
          <Button onClick={() => saveBlob(shown.repaired ?? shown.file, shown.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.repair.save', { name: shown.name })}
          </Button>
        </section>
      )}
    </div>
  );
}
