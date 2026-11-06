import { useTranslation } from 'react-i18next';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dropzone } from '@/features/convert/Dropzone';
import { formatBytes } from '@/lib/format-bytes';

/** One file for a workshop trick: a drop area, or the chosen file with "other file". */
export function SingleFile({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!file) return <Dropzone compact onFiles={(files) => onFile(files[0] ?? null)} />;
  return (
    <Card className="flex-row flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{file.name}</p>
        <p className="text-sm text-muted-foreground">{formatBytes(file.size, i18n.language)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => onFile(null)}>
        <RefreshCwIcon aria-hidden="true" />
        {t('workshop.otherFile')}
      </Button>
    </Card>
  );
}

/** The "how it works" box every trick has. */
export function HowItWorks({ trick }: { trick: string }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{t('workshop.howItWorks')}</summary>
      <p className="mt-2 leading-relaxed">{t(`workshop.tricks.${trick}.how`)}</p>
    </details>
  );
}
