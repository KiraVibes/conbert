import { useEffect, useState } from 'react';
import { FileIcon, FolderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorMessage } from '@/components/ErrorMessage';
import { formatBytes } from '@/lib/format-bytes';
import { PreviewLoading } from './PreviewStatus';
import type { PreviewSource } from './preview-source';

const loading = { status: 'loading' as const, progress: 0, converting: false };
const SHOWN_ENTRIES = 300;

interface ArchiveListing {
  entries: { path: string; size: number }[];
  total: number;
}

/** The files inside an archive (read with libarchive.js, nothing is unpacked). */
export function ArchivePreview({ source }: { source: PreviewSource }) {
  const { t, i18n } = useTranslation();
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { Archive } = await import('libarchive.js');
      Archive.init({
        workerUrl: new URL('/wasm/libarchive/worker-bundle.js', window.location.origin),
      });
      const reader = await Archive.open(new File([source.blob], `preview.${source.ext}`));
      try {
        const files = (await reader.getFilesArray()) as {
          file: { name: string; size: number };
          path: string;
        }[];
        const entries = files
          .map((f) => ({ path: `${f.path}${f.file.name}`, size: f.file.size }))
          .sort((a, b) => a.path.localeCompare(b.path));
        if (!cancelled) setListing({ entries, total: entries.reduce((s, e) => s + e.size, 0) });
      } finally {
        await reader.close().catch(() => undefined);
      }
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) return <ErrorMessage messageKey="errors.previewUnavailable" details={error} />;
  if (!listing) return <PreviewLoading state={loading} />;
  return (
    <div className="space-y-2" data-testid="archive-preview">
      <p className="text-sm text-muted-foreground">
        {t('preview.archiveEntries', {
          count: listing.entries.length,
          size: formatBytes(listing.total, i18n.language),
        })}
      </p>
      <ul className="max-h-[60vh] overflow-auto rounded-md border p-2 font-mono text-sm">
        {listing.entries.slice(0, SHOWN_ENTRIES).map((entry) => {
          const depth = entry.path.split('/').length - 1;
          const name = entry.path.split('/').at(-1) ?? entry.path;
          return (
            <li
              key={entry.path}
              className="flex items-center gap-2 py-0.5"
              style={{ paddingLeft: `${depth * 1.25}rem` }}
            >
              {depth > 0 && (
                <FolderIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate" title={entry.path}>
                {depth > 0 ? `${entry.path.split('/').slice(0, -1).join('/')}/` : ''}
                <strong>{name}</strong>
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatBytes(entry.size, i18n.language)}
              </span>
            </li>
          );
        })}
      </ul>
      {listing.entries.length > SHOWN_ENTRIES && (
        <p className="text-sm text-muted-foreground">
          {t('preview.archiveMore', { count: listing.entries.length - SHOWN_ENTRIES })}
        </p>
      )}
    </div>
  );
}

let fontCounter = 0;

/** A font shown in several sizes, with your own sample text. */
export function FontPreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const [family, setFamily] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState('');

  useEffect(() => {
    let face: FontFace | null = null;
    let cancelled = false;
    const name = `conbert-preview-${++fontCounter}`;
    void source.blob
      .arrayBuffer()
      .then((data) => new FontFace(name, data).load())
      .then((loaded) => {
        if (cancelled) return;
        face = loaded;
        document.fonts.add(loaded);
        setFamily(name);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      if (face) document.fonts.delete(face);
    };
  }, [source]);

  if (error) return <ErrorMessage messageKey="errors.previewUnavailable" details={error} />;
  if (!family) return <PreviewLoading state={loading} />;
  const text = sample || t('preview.fontSample');
  return (
    <div className="space-y-4" data-testid="font-preview">
      <div className="space-y-1.5">
        <Label htmlFor="font-sample">{t('preview.fontYourText')}</Label>
        <Input
          id="font-sample"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder={t('preview.fontSample')}
        />
      </div>
      <div
        className="max-h-[55vh] space-y-3 overflow-auto rounded-md border p-4"
        style={{ fontFamily: `"${family}", monospace` }}
      >
        {[14, 20, 32, 56].map((size) => (
          <p key={size} style={{ fontSize: size }} className="break-words">
            <span className="mr-3 align-middle font-sans text-xs text-muted-foreground">
              {size}px
            </span>
            {text}
          </p>
        ))}
        <p style={{ fontSize: 28 }} className="break-all">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ÄÖÜäöüß 0123456789 &amp;!?€@
        </p>
      </div>
    </div>
  );
}

interface TableData {
  columns: string[];
  rows: unknown[][];
  total: number;
}

/** First rows of a CSV or Excel file as a table. */
export function TablePreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const [table, setTable] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { previewTable } = await import('@conbert/core/data');
      const data = await previewTable(new Uint8Array(await source.blob.arrayBuffer()), source.ext);
      if (!cancelled) setTable(data);
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) return <ErrorMessage messageKey="errors.previewUnavailable" details={error} />;
  if (!table) return <PreviewLoading state={loading} />;
  return (
    <div className="space-y-2" data-testid="table-preview">
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="border-b px-2 py-1.5 text-left font-medium whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="odd:bg-muted/30">
                {row.map((cell, j) => (
                  <td key={j} className="border-b px-2 py-1 whitespace-nowrap">
                    {cell === null || cell === undefined ? '' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('preview.tableRows', { shown: table.rows.length, total: table.total })}
      </p>
    </div>
  );
}
