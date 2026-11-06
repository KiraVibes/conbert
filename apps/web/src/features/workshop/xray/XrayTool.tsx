import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dropzone } from '@/features/convert/Dropzone';
import { formatBytes } from '@/lib/format-bytes';
import { EntropyPanel } from '../entropy/EntropyPanel';
import { HashesPanel } from '../hashes/HashesPanel';
import { HexViewer } from '../hex/HexViewer';
import { DetectivePanel } from '../detective/DetectivePanel';
import { IdentifyPanel } from '../identify/IdentifyPanel';
import { XRAY_TRICKS, type XrayTrick } from './tricks';
import { useXray } from './use-xray';

/**
 * "Datei-Röntgen": one file, four views. The file stays while switching,
 * so a look at the hex bytes doesn't mean choosing it again.
 */
export function XrayTool({
  trick,
  onTrick,
}: {
  trick: XrayTrick;
  onTrick: (trick: XrayTrick) => void;
}) {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [jumpTo, setJumpTo] = useState<{ offset: number } | null>(null);
  const xray = useXray(file);
  // Views stay mounted once opened: going back doesn't compute checksums again.
  const [visited, setVisited] = useState<ReadonlySet<XrayTrick>>(() => new Set([trick]));
  if (!visited.has(trick)) setVisited(new Set([...visited, trick]));

  const showOffset = (offset: number) => {
    setJumpTo({ offset });
    onTrick('hex');
  };

  return (
    <div className="space-y-4">
      {file ? (
        <Card className="flex-row flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground">{formatBytes(file.size, i18n.language)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFile(null)}>
            <RefreshCwIcon aria-hidden="true" />
            {t('workshop.otherFile')}
          </Button>
        </Card>
      ) : (
        <Dropzone compact onFiles={(files) => setFile(files[0] ?? null)} />
      )}

      <Tabs value={trick} onValueChange={(v) => onTrick(v as XrayTrick)} className="gap-4">
        <TabsList className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto sm:flex">
          {XRAY_TRICKS.map((id) => (
            <TabsTrigger key={id} value={id} className="h-auto min-h-7 whitespace-normal">
              {t(`workshop.tricks.${id}.title`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {XRAY_TRICKS.filter((id) => visited.has(id) || id === trick).map((id) => (
          <TabsContent
            key={id}
            value={id}
            forceMount
            className="space-y-4 data-[state=inactive]:hidden"
          >
            <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">{t('workshop.howItWorks')}</summary>
              <p className="mt-2 leading-relaxed">{t(`workshop.tricks.${id}.how`)}</p>
            </details>
            {!file ? (
              <p className="text-sm text-muted-foreground">{t('workshop.chooseFile')}</p>
            ) : xray.loading || !xray.identity ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {t('workshop.reading')}
              </p>
            ) : id === 'identify' ? (
              <IdentifyPanel
                file={file}
                identity={xray.identity}
                structure={xray.structure}
                head={xray.head}
                onShowOffset={showOffset}
              />
            ) : id === 'hex' ? (
              <HexViewer
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                structure={xray.structure}
                jumpTo={jumpTo}
              />
            ) : id === 'detective' ? (
              <DetectivePanel
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                ext={xray.identity.realExt ?? xray.identity.nameExt}
                onShowOffset={showOffset}
              />
            ) : id === 'hashes' ? (
              <HashesPanel key={`${file.name}-${file.size}-${file.lastModified}`} file={file} />
            ) : (
              <EntropyPanel
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                onShowOffset={showOffset}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
