import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FolderDownIcon, Loader2Icon } from 'lucide-react';
import { packZip, type Finding, type PackFile } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { saveBlob } from '../save-blob';
import { carvePart } from '../workshop-worker';
import { partName } from './save-part';

/** Finds that are whole files of their own (what "carving" pulls out). */
function carvable(f: Finding): boolean {
  return (
    f.format !== null &&
    f.length > 0 &&
    !f.trick &&
    (f.kind === 'embedded' || f.kind === 'appended' || f.kind === 'thumbnail')
  );
}

/** "Datei-Carving": every found file at once, in one ZIP. */
export function SaveAllParts({ file, findings }: { file: File; findings: readonly Finding[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const parts = findings.filter(carvable);
  if (parts.length < 2) return null;

  async function saveAll() {
    setBusy(true);
    try {
      const files: PackFile[] = [];
      let skipped = 0;
      for (const f of parts) {
        const r = await carvePart(file, f.offset, f.length, f.format);
        if (r.ok) files.push({ name: partName(file.name, f.offset, f.format), data: r.data });
        else skipped++;
      }
      if (files.length === 0) {
        toast.error(t('workshop.detective.saveAllNone'));
        return;
      }
      const zip = await packZip(files);
      saveBlob(
        new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
        `${file.name.replace(/\.[^.]+$/, '')}-funde.zip`,
      );
      if (skipped > 0) toast.info(t('workshop.detective.saveAllSkipped', { count: skipped }));
    } catch (e) {
      console.error(e);
      toast.error(t('workshop.detective.saveAllFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={() => void saveAll()} disabled={busy}>
      {busy ? (
        <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <FolderDownIcon aria-hidden="true" />
      )}
      {t('workshop.detective.saveAll', { count: parts.length })}
    </Button>
  );
}
