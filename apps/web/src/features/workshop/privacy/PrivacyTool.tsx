import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleCheckIcon,
  EraserIcon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldAlertIcon,
} from 'lucide-react';
import {
  isOfficeFile,
  metadataWritable,
  parseGps,
  privacyFromTags,
  type PrivacyFinding,
} from '@conbert/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readMetadata, writeMetadataEdits } from '@/features/metadata/metadata-engine';
import { detectFileType } from '@/lib/detect-type';
import { cn } from '@/lib/utils';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { carvePart, inspectWorker, runScan } from '../workshop-worker';

interface Check {
  ext: string;
  findings: PrivacyFinding[];
  /** The EXIF preview and how far it is from the picture. */
  thumbnail: { url: string; difference: number; shapeDiffers: boolean } | null;
  failed: boolean;
}

const LEVEL_CLASS = {
  high: 'border-destructive/40 bg-destructive/5',
  medium: 'border-amber-500/40 bg-amber-500/5',
  low: '',
} as const;

/** The small preview inside a JPEG's EXIF data, compared with the picture itself. */
async function thumbnailCheck(file: File): Promise<Check['thumbnail']> {
  const report = await runScan(file, 'jpg', () => undefined);
  const thumb = report.findings.find((f) => f.kind === 'thumbnail');
  if (!thumb) return null;
  const part = await carvePart(file, thumb.offset, thumb.length, 'jpg');
  if (!part.ok) return null;
  const blob = new Blob([part.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  const cmp = await inspectWorker.compareThumbnail(file, blob).catch(() => null);
  return cmp ? { url: URL.createObjectURL(blob), ...cmp } : null;
}

async function check(file: File): Promise<Check> {
  const { ext } = await detectFileType(file);
  let failed = false;
  const tags = await readMetadata(file, ext).catch(() => {
    failed = true;
    return {};
  });
  const findings = privacyFromTags(tags);
  if (isOfficeFile(ext)) findings.push(...(await inspectWorker.officePrivacy(file)));
  const thumbnail =
    ext === 'jpg' && findings.some((f) => f.kind === 'thumbnail')
      ? await thumbnailCheck(file).catch(() => null)
      : null;
  return { ext, findings, thumbnail, failed: failed && findings.length === 0 };
}

function FindingCard({ finding }: { finding: PrivacyFinding }) {
  const { t } = useTranslation();
  const gps = finding.kind === 'location' ? parseGps(finding.values[0] ?? '') : null;
  return (
    <li className={cn('space-y-1.5 rounded-lg border p-3', LEVEL_CLASS[finding.level])}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={finding.level === 'high' ? 'destructive' : 'secondary'}>
          {t(`workshop.privacy.levels.${finding.level}`)}
        </Badge>
        <p className="font-medium">
          {t(`workshop.privacy.kinds.${finding.kind}.title`, { count: finding.count ?? 0 })}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(`workshop.privacy.kinds.${finding.kind}.help`)}
      </p>
      {finding.values.length > 0 && finding.kind !== 'thumbnail' && (
        <ul className="flex flex-wrap gap-1.5">
          {finding.values.map((v) => (
            <li key={v} className="rounded bg-muted px-2 py-0.5 text-xs break-all">
              {v}
            </li>
          ))}
        </ul>
      )}
      {gps && (
        <Button size="sm" variant="outline" asChild>
          <a
            href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=15/${gps.lat}/${gps.lon}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLinkIcon aria-hidden="true" />
            {t('workshop.privacy.showMap')}
          </a>
        </Button>
      )}
    </li>
  );
}

/** "Was verrät meine Datei?" – location, devices, people, comments … and removing it. */
export function PrivacyTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ file: File; check: Check } | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    if (!file) return;
    let active = true;
    void check(file).then((c) => active && setResult({ file, check: c }));
    return () => {
      active = false;
    };
  }, [file]);

  // The preview's object URL is freed with the result.
  useEffect(() => {
    const url = result?.check.thumbnail?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  const current = file && result?.file === file ? result.check : null;
  const high = current?.findings.filter((f) => f.level === 'high').length ?? 0;
  const thumbUrl = current?.thumbnail?.url;
  // The picture next to its preview – one URL per file, freed when it changes.
  const pictureUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    },
    [pictureUrl],
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="privacy" />
      <SingleFile file={file} onFile={setFile} />
      {file && !current && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.privacy.reading')}
        </p>
      )}
      {file && current && (
        <div className="space-y-4">
          <div
            role="status"
            className={cn(
              'flex items-start gap-3 rounded-lg border p-4',
              current.findings.length === 0
                ? 'border-emerald-600/30 bg-emerald-600/5'
                : high > 0
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-amber-500/40 bg-amber-500/10',
            )}
          >
            {current.findings.length === 0 ? (
              <CircleCheckIcon
                className="mt-0.5 size-5 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
            ) : (
              <ShieldAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            )}
            <p className="font-medium">
              {current.failed
                ? t('workshop.privacy.failed')
                : current.findings.length === 0
                  ? t('workshop.privacy.clean')
                  : t('workshop.privacy.found', { count: current.findings.length, high })}
            </p>
          </div>

          {current.thumbnail && thumbUrl && pictureUrl && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">{t('workshop.privacy.thumbTitle')}</h3>
              <p className="text-sm">
                {current.thumbnail.shapeDiffers || current.thumbnail.difference >= 15
                  ? t('workshop.privacy.thumbDiffers')
                  : t('workshop.privacy.thumbSame')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <figure className="space-y-1">
                  <img src={pictureUrl} alt="" className="max-h-48 rounded border object-contain" />
                  <figcaption className="text-xs text-muted-foreground">
                    {t('workshop.privacy.thePicture')}
                  </figcaption>
                </figure>
                <figure className="space-y-1">
                  <img src={thumbUrl} alt="" className="max-h-48 rounded border object-contain" />
                  <figcaption className="text-xs text-muted-foreground">
                    {t('workshop.privacy.theThumbnail')}
                  </figcaption>
                </figure>
              </div>
            </section>
          )}

          {current.findings.length > 0 && (
            <ul className="space-y-2">
              {current.findings.map((f) => (
                <FindingCard key={f.kind} finding={f} />
              ))}
            </ul>
          )}

          {current.findings.length > 0 &&
            (metadataWritable(current.ext) ? (
              <Button
                disabled={cleaning}
                onClick={() => {
                  setCleaning(true);
                  void writeMetadataEdits(file, current.ext, {
                    values: {},
                    removeGps: false,
                    removeAll: true,
                  })
                    .then((clean) => saveBlob(clean, file.name))
                    .finally(() => setCleaning(false));
                }}
              >
                {cleaning ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <EraserIcon aria-hidden="true" />
                )}
                {t('workshop.privacy.removeAll')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isOfficeFile(current.ext)
                  ? t('workshop.privacy.officeHowTo')
                  : t('workshop.privacy.cannotRemove')}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
