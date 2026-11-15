import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BYTE_KIND_COLORS,
  BYTE_KINDS,
  FILE_MAP_MODES,
  fileMap,
  fileMapOffset,
  type FileMapMode,
} from '@conbert/core';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { hex, printable } from '../save-blob';

/** Files up to this size are mapped completely (they are read into memory). */
const MAX_BYTES = 512 * 1024 * 1024;

/** Datei-Landkarte – a file's bytes as a picture. */
export function FileMapTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<{ file: File; b: Uint8Array } | null>(null);
  const [mode, setMode] = useState<FileMapMode>('kind');
  const [spot, setSpot] = useState<{ from: number; to: number } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    file
      .slice(0, MAX_BYTES)
      .arrayBuffer()
      .then((buf) => active && setBytes({ file, b: new Uint8Array(buf) }))
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const current = bytes && bytes.file === file ? bytes.b : null;
  const map = useMemo(() => (current ? fileMap(current, mode) : null), [current, mode]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !map) return;
    c.width = map.side;
    c.height = map.side;
    c.getContext('2d')?.putImageData(new ImageData(map.rgba, map.side, map.side), 0, 0);
  }, [map]);

  function look(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!map || !current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * map.side);
    const y = Math.floor(((e.clientY - r.top) / r.height) * map.side);
    if (x < 0 || y < 0 || x >= map.side || y >= map.side) return;
    setSpot(fileMapOffset(map, current.length, x, y));
  }

  const number = (n: number) => n.toLocaleString(i18n.language);
  const preview =
    spot && current ? current.subarray(spot.from, Math.min(spot.from + 16, current.length)) : null;
  return (
    <div className="space-y-4">
      <HowItWorks trick="filemap" />
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setSpot(null);
        }}
      />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.filemap.failed')}
        </p>
      )}
      {map && current && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={t('workshop.filemap.mode')}
            >
              {FILE_MAP_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    mode === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                  )}
                >
                  {t(`workshop.filemap.modes.${m}`)}
                </button>
              ))}
            </div>
            <canvas
              ref={canvas}
              onPointerMove={look}
              onPointerDown={look}
              className="aspect-square w-full cursor-crosshair rounded-lg border [image-rendering:pixelated]"
              role="img"
              aria-label={t('workshop.filemap.picture')}
              data-testid="filemap-canvas"
            />
            <p className="text-xs text-muted-foreground">
              {t('workshop.filemap.scale', { count: map.chunk, bytes: number(map.chunk) })}
              {file &&
                file.size > current.length &&
                ` ${t('workshop.filemap.cut', { size: number(current.length) })}`}
            </p>
          </div>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t(`workshop.filemap.modeHelp.${mode}`)}</p>
            {mode === 'kind' ? (
              <ul className="space-y-1.5">
                {BYTE_KINDS.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <span
                      className="size-4 shrink-0 rounded-sm border"
                      style={{ background: `rgb(${BYTE_KIND_COLORS[k].join(',')})` }}
                    />
                    <span className="flex-1">{t(`workshop.filemap.kinds.${k}`)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(map.shares[k] * 1000) / 10} %
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-1">
                <div className="h-3 rounded-sm bg-[linear-gradient(90deg,rgb(20,40,120),rgb(220,220,40),rgb(250,40,20))]" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('workshop.filemap.entropyLow')}</span>
                  <span>{t('workshop.filemap.entropyHigh')}</span>
                </div>
              </div>
            )}
            <div className="rounded-lg border p-3" aria-live="polite">
              {spot && preview ? (
                <>
                  <p className="font-medium">
                    {t('workshop.filemap.at', {
                      offset: `0x${hex(spot.from, 8)}`,
                      count: spot.to - spot.from,
                      bytes: number(spot.to - spot.from),
                    })}
                  </p>
                  <p className="mt-1 font-mono text-xs break-all">
                    {[...preview].map((b) => hex(b, 2)).join(' ')}
                  </p>
                  <p className="font-mono text-xs">{[...preview].map(printable).join('')}</p>
                </>
              ) : (
                <p className="text-muted-foreground">{t('workshop.filemap.pointHint')}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('workshop.filemap.reading')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
