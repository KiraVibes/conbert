import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeOffIcon, FileIcon, Loader2Icon, SparklesIcon, XIcon } from 'lucide-react';
import { ARCHIVE_COVERS, POLYGLOT_HOSTS, findSignature, type Finding } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dropzone } from '@/features/convert/Dropzone';
import { formatBytes } from '@/lib/format-bytes';
import { DetectivePanel } from '../detective/DetectivePanel';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { baseName, useObjectUrl } from '../stego/use-stego';
import { archiveWorker, type ArchiveSource, type BytesResult } from '../workshop-worker';
import { archiveNames } from './list-archive';

/** 'append': archive behind a picture. 'polyglot': ZIP inside a PNG or PDF. */
export type ArchiveMode = 'append' | 'polyglot';

const TEXT = 'workshop.archiveImage';

/** The real type of a file, from its first bytes. */
function useRealExt(file: File | null): string | null | undefined {
  const [state, setState] = useState<{ file: File; ext: string | null } | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    void file
      .slice(0, 64)
      .arrayBuffer()
      .then(
        (b) => current && setState({ file, ext: findSignature(new Uint8Array(b))?.ext ?? null }),
      );
    return () => {
      current = false;
    };
  }, [file]);
  if (!file) return undefined;
  return state?.file === file ? state.ext : undefined;
}

function FileList({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const { t, i18n } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatBytes(f.size, i18n.language)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(`${TEXT}.removeFile`, { name: f.name })}
            onClick={() => onRemove(i)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Hide({ mode }: { mode: ArchiveMode }) {
  const { t } = useTranslation();
  const polyglot = mode === 'polyglot';
  const [cover, setCover] = useState<File | null>(null);
  const [kind, setKind] = useState<'files' | 'archive'>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [archive, setArchive] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: Blob; name: string; locked: boolean } | null>(null);
  const coverExt = useRealExt(cover);
  const archiveExt = useRealExt(archive);
  const allowedCovers: readonly string[] = polyglot ? POLYGLOT_HOSTS : ARCHIVE_COVERS;
  const allowedArchives: readonly string[] = polyglot ? ['zip'] : ['zip', 'rar', '7z'];
  const coverOk = coverExt != null && allowedCovers.includes(coverExt);
  const archiveOk = archiveExt != null && allowedArchives.includes(archiveExt);
  const ready = coverOk && (kind === 'files' ? files.length > 0 : archiveOk);
  const resultUrl = useObjectUrl(result && coverExt !== 'pdf' ? result.file : null);

  const errorText = (r: Extract<BytesResult, { ok: false }>) =>
    t(`workshop.errors.${r.code}`, { name: r.detail ?? '' });

  const run = async () => {
    if (!cover || !coverExt) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let source: ArchiveSource;
      if (kind === 'files') {
        source = { kind: 'files', files, password };
      } else {
        if (!archive) return;
        const names =
          archiveExt === 'rar' || archiveExt === '7z' ? await archiveNames(archive) : undefined;
        if (names === null) {
          setError(t('workshop.errors.unchecked'));
          return;
        }
        source = { kind: 'archive', archive, ...(names && { names }) };
      }
      const r = await archiveWorker.hide(cover, source, polyglot);
      if (r.ok) {
        const ext = coverExt === 'jpg' ? 'jpg' : coverExt;
        setResult({
          file: new Blob([r.data as Uint8Array<ArrayBuffer>]),
          name: `${baseName(cover.name, polyglot ? 'polyglot' : 'bild')}-zip.${ext}`,
          locked: kind === 'files' && password !== '',
        });
      } else {
        setError(errorText(r));
      }
    } catch (e) {
      console.error('archive in picture failed', e);
      setError(t(`${TEXT}.failed`));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setResult(null);
  const archiveKind = kind === 'archive' ? archiveExt : 'zip';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t(polyglot ? `${TEXT}.host` : `${TEXT}.cover`)}</Label>
        <SingleFile
          file={cover}
          onFile={(f) => {
            setCover(f);
            reset();
          }}
        />
        <p className="text-xs text-muted-foreground">
          {t(polyglot ? `${TEXT}.hostHint` : `${TEXT}.coverHint`)}
        </p>
        {cover && coverExt !== undefined && !coverOk && (
          <p role="alert" className="text-sm text-destructive">
            {t(polyglot ? `${TEXT}.wrongHost` : `${TEXT}.wrongCover`)}
          </p>
        )}
      </div>

      <ToggleGroup
        type="single"
        variant="outline"
        value={kind}
        onValueChange={(v) => {
          if (!v) return;
          setKind(v as 'files' | 'archive');
          reset();
        }}
        aria-label={t(`${TEXT}.what`)}
      >
        <ToggleGroupItem value="files">{t(`${TEXT}.kindFiles`)}</ToggleGroupItem>
        <ToggleGroupItem value="archive">
          {t(polyglot ? `${TEXT}.kindZip` : `${TEXT}.kindArchive`)}
        </ToggleGroupItem>
      </ToggleGroup>

      {kind === 'files' ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t(`${TEXT}.files`)}</Label>
            <Dropzone
              compact
              onFiles={(added) => {
                setFiles((old) => [...old, ...added]);
                reset();
              }}
            />
            <p className="text-xs text-muted-foreground">{t('workshop.stego.noPrograms')}</p>
          </div>
          <FileList
            files={files}
            onRemove={(i) => {
              setFiles((old) => old.filter((_, j) => j !== i));
              reset();
            }}
          />
          <div className="max-w-sm space-y-1">
            <Label htmlFor={`${mode}-archive-password`} className="flex items-center gap-1">
              {t('workshop.stego.password')}
              <HelpTip helpKey={`${TEXT}.passwordHelp`} labelKey="workshop.stego.password" />
            </Label>
            <Input
              id={`${mode}-archive-password`}
              type="password"
              autoComplete="new-password"
              placeholder={t('workshop.stego.passwordPlaceholder')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                reset();
              }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label>{t(polyglot ? `${TEXT}.zipFile` : `${TEXT}.archiveFile`)}</Label>
          <SingleFile
            file={archive}
            onFile={(f) => {
              setArchive(f);
              reset();
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t(polyglot ? `${TEXT}.zipHint` : `${TEXT}.archiveHint`)}
          </p>
          {archive && archiveExt !== undefined && !archiveOk && (
            <p role="alert" className="text-sm text-destructive">
              {t(polyglot ? `${TEXT}.wrongZip` : `${TEXT}.wrongArchive`)}
            </p>
          )}
        </div>
      )}

      <Button onClick={() => void run()} disabled={!ready || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <EyeOffIcon aria-hidden="true" />
        )}
        {t(busy ? `${TEXT}.hiding` : `${TEXT}.hide`)}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <section className="space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <p className="flex items-center gap-2 font-medium" role="status">
            <SparklesIcon className="size-4 text-emerald-600" aria-hidden="true" />
            {t(coverExt === 'pdf' ? `${TEXT}.donePdf` : `${TEXT}.done`)}
          </p>
          {resultUrl && (
            <img
              src={resultUrl}
              alt={t(`${TEXT}.resultAlt`)}
              className="max-h-64 rounded-md border"
            />
          )}
          <Button onClick={() => saveBlob(result.file, result.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.stego.save', { name: result.name })}
          </Button>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t(`${TEXT}.howToOpen`)}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t(coverExt === 'pdf' ? `${TEXT}.openPdf` : `${TEXT}.openPicture`)}</li>
              <li>
                {t(
                  archiveKind === 'rar' || archiveKind === '7z'
                    ? `${TEXT}.openRar`
                    : `${TEXT}.openZip`,
                  { ext: archiveKind ?? 'zip' },
                )}
              </li>
              {result.locked && <li>{t(`${TEXT}.openLocked`)}</li>}
            </ol>
          </div>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {t(`${TEXT}.keepSafe`)}
          </p>
        </section>
      )}
    </div>
  );
}

const isArchive = (f: Finding) =>
  f.format === 'zip' || f.format === 'rar' || f.format === '7z' || f.kind === 'prefix';

function Reveal() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const ext = useRealExt(file);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`${TEXT}.revealIntro`)}</p>
      <SingleFile file={file} onFile={setFile} />
      {file && ext !== undefined && (
        <DetectivePanel
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          ext={ext}
          only={isArchive}
        />
      )}
    </div>
  );
}

/**
 * "Archiv im Bild" and polyglot files: one file that opens as a picture (or
 * PDF) and as an archive – and the way back, finding such archives.
 */
export function ArchiveImageTool({ mode }: { mode: ArchiveMode }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick={mode === 'polyglot' ? 'polyglot' : 'archiveimage'} />
      <Tabs defaultValue="hide" className="gap-4">
        <TabsList>
          <TabsTrigger value="hide">{t('workshop.stego.hideTab')}</TabsTrigger>
          <TabsTrigger value="reveal">{t('workshop.stego.revealTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="hide" forceMount className="data-[state=inactive]:hidden">
          <Hide mode={mode} />
        </TabsContent>
        <TabsContent value="reveal" forceMount className="data-[state=inactive]:hidden">
          <Reveal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
