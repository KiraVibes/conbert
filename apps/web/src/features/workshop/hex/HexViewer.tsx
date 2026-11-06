import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import { REGION_KINDS, regionAt, type FileStructure } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { hex, parseOffset, printable, saveBlob } from '../save-blob';
import { DataInspector } from './DataInspector';
import { FieldTable } from './FieldTable';
import { HexSearch } from './HexSearch';
import { MiniMap } from './MiniMap';
import { KIND_CLASS, regionText } from './regions';

const ROW_HEIGHT = 22;
const VIEW_HEIGHT = 22 * 18;
/** Browsers can't draw endlessly tall elements; beyond this the scrollbar is scaled. */
const MAX_SPACER = 8_000_000;
/** Rows read around the visible part, so scrolling rarely waits. */
const READ_AHEAD_ROWS = 256;
const MAX_LISTED_REGIONS = 300;

interface Loaded {
  start: number;
  bytes: Uint8Array;
}

/** A hex/ASCII view of any size: only the visible rows are read and drawn. */
export function HexViewer({
  file,
  structure,
  jumpTo,
}: {
  file: File;
  structure: FileStructure | null;
  /** Show this byte (a new object each time, so the same offset works twice). */
  jumpTo: { offset: number } | null;
}) {
  const { t, i18n } = useTranslation();
  const outer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(16);
  const [scrollTop, setScrollTop] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ start: 0, bytes: new Uint8Array(0) });
  const clamp = (offset: number) => Math.max(0, Math.min(file.size - 1, offset));
  const [selected, setSelected] = useState(() => clamp(jumpTo?.offset ?? 0));
  /** Start of a marked range (Shift+click or Shift+arrow keys), null = one byte. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const range =
    anchor === null || anchor === selected
      ? null
      : { from: Math.min(anchor, selected), to: Math.max(anchor, selected) };
  const inRange = (offset: number) => range !== null && offset >= range.from && offset <= range.to;
  const pick = (offset: number, extend: boolean) => {
    setAnchor(extend ? (anchor ?? selected) : null);
    setSelected(offset);
  };
  // A new jump from outside selects its byte right away …
  const [seenJump, setSeenJump] = useState(jumpTo);
  if (jumpTo !== seenJump) {
    setSeenJump(jumpTo);
    if (jumpTo) {
      setSelected(clamp(jumpTo.offset));
      setAnchor(null);
    }
  }
  const [goTo, setGoTo] = useState('');
  const [goToError, setGoToError] = useState(false);
  const regions = structure?.regions ?? [];

  // Narrow screens show 8 bytes per row.
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setPerRow((entry?.contentRect.width ?? 800) < 560 ? 8 : 16);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalRows = Math.max(1, Math.ceil(file.size / perRow));
  const visibleRows = Math.ceil(VIEW_HEIGHT / ROW_HEIGHT);
  const contentHeight = totalRows * ROW_HEIGHT;
  const spacer = Math.min(contentHeight, MAX_SPACER);
  const scaled = contentHeight > MAX_SPACER;
  const maxFirst = Math.max(0, totalRows - visibleRows);
  const firstRow = scaled
    ? Math.min(maxFirst, Math.round((scrollTop / Math.max(1, spacer - VIEW_HEIGHT)) * maxFirst))
    : Math.floor(scrollTop / ROW_HEIGHT);
  const pixelShift = scaled ? 0 : scrollTop % ROW_HEIGHT;
  const offsetDigits = file.size > 0xffffffff ? 10 : 8;

  // Read the bytes around the visible rows when they're not loaded yet.
  useEffect(() => {
    const from = firstRow * perRow;
    const to = Math.min(file.size, (firstRow + visibleRows + 1) * perRow);
    if (from >= loaded.start && to <= loaded.start + loaded.bytes.length) return;
    let active = true;
    const start = Math.max(0, (firstRow - READ_AHEAD_ROWS) * perRow);
    const end = Math.min(file.size, (firstRow + visibleRows + READ_AHEAD_ROWS) * perRow);
    void file
      .slice(start, end)
      .arrayBuffer()
      .then((buffer) => {
        if (active) setLoaded({ start, bytes: new Uint8Array(buffer) });
      });
    return () => {
      active = false;
    };
  }, [file, firstRow, perRow, visibleRows, loaded]);

  const scrollToRow = useCallback(
    (row: number) => {
      const el = scroller.current;
      if (!el) return;
      const target = Math.max(0, Math.min(maxFirst, row - Math.floor(visibleRows / 3)));
      el.scrollTop = scaled
        ? (target / Math.max(1, maxFirst)) * (spacer - VIEW_HEIGHT)
        : target * ROW_HEIGHT;
      // The scroll event updates scrollTop (and with it the rows).
    },
    [maxFirst, scaled, spacer, visibleRows],
  );

  const show = useCallback(
    (offset: number) => {
      const clamped = Math.max(0, Math.min(file.size - 1, offset));
      setSelected(clamped);
      setAnchor(null);
      scrollToRow(Math.floor(clamped / perRow));
    },
    [file.size, perRow, scrollToRow],
  );

  /** Marks a whole range (a search hit) and scrolls to its start. */
  const showRange = (from: number, to: number) => {
    // The selection sits on the hit's first byte, the range reaches to its end.
    setAnchor(to);
    setSelected(from);
    scrollToRow(Math.floor(from / perRow));
  };

  // … and scrolls there once the rows can be measured.
  const scrolledJump = useRef<{ offset: number } | null>(null);
  useEffect(() => {
    if (!jumpTo || scrolledJump.current === jumpTo) return;
    scrolledJump.current = jumpTo;
    scrollToRow(Math.floor(Math.max(0, jumpTo.offset) / perRow));
  }, [jumpTo, perRow, scrollToRow]);

  // Keep the selected byte visible when moving with the keyboard.
  const moveSelection = (next: number, extend: boolean) => {
    const clamped = Math.max(0, Math.min(file.size - 1, next));
    pick(clamped, extend);
    const row = Math.floor(clamped / perRow);
    if (row < firstRow || row >= firstRow + visibleRows - 1) scrollToRow(row);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -perRow,
      ArrowDown: perRow,
      PageUp: -perRow * (visibleRows - 1),
      PageDown: perRow * (visibleRows - 1),
    };
    const extend = event.shiftKey;
    if (event.key === 'Home' && event.ctrlKey) moveSelection(0, extend);
    else if (event.key === 'End' && event.ctrlKey) moveSelection(file.size - 1, extend);
    else if (step[event.key] !== undefined) {
      moveSelection(selected + (step[event.key] ?? 0), extend);
    } else return;
    event.preventDefault();
  };

  const byteAt = (offset: number): number | null => {
    const i = offset - loaded.start;
    return i >= 0 && i < loaded.bytes.length ? (loaded.bytes[i] ?? null) : null;
  };

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let r = firstRow; r < Math.min(totalRows, firstRow + visibleRows + 1); r++) out.push(r);
    return out;
  }, [firstRow, totalRows, visibleRows]);

  const selectedByte = byteAt(selected);
  const selectedRegion = regionAt(regions, selected);
  const selectedField = selectedRegion?.fields?.find(
    (f) => selected >= f.start && selected < f.end,
  );
  const inField = (offset: number) =>
    selectedField !== undefined && offset >= selectedField.start && offset < selectedField.end;
  // Up to 8 bytes from the selected one (or the start of a marked range),
  // for the data inspector – as far as they are loaded.
  const inspectFrom = range ? range.from : selected;
  const inspected: number[] = [];
  for (let i = 0; i < 8; i++) {
    const b = byteAt(inspectFrom + i);
    if (b === null) break;
    inspected.push(b);
  }
  const listed = regions.slice(0, MAX_LISTED_REGIONS);

  return (
    <div ref={outer} className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const offset = parseOffset(goTo);
          setGoToError(offset === null || offset >= file.size);
          if (offset !== null && offset < file.size) show(offset);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="hex-goto">{t('workshop.hex.goTo')}</Label>
          <Input
            id="hex-goto"
            className="w-40 font-mono"
            placeholder="0x0400"
            value={goTo}
            aria-invalid={goToError || undefined}
            onChange={(event) => setGoTo(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          {t('workshop.hex.goToButton')}
        </Button>
        {goToError && <p className="text-sm text-destructive">{t('workshop.hex.goToInvalid')}</p>}
      </form>

      <HexSearch file={file} selected={selected} onFound={showRange} />

      <div className="flex gap-2">
        <div
          ref={scroller}
          tabIndex={0}
          role="grid"
          aria-label={t('workshop.hex.label')}
          aria-rowcount={totalRows}
          onKeyDown={onKeyDown}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="min-w-0 flex-1 overflow-y-auto rounded-lg border bg-card font-mono text-[13px] leading-[22px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={{ height: VIEW_HEIGHT }}
        >
          <div style={{ height: spacer }}>
            <div className="sticky top-0 overflow-hidden" style={{ height: VIEW_HEIGHT }}>
              <div style={{ transform: `translateY(-${pixelShift}px)` }}>
                {rows.map((row) => {
                  const base = row * perRow;
                  const cells = Array.from({ length: perRow }, (_, i) => base + i).filter(
                    (o) => o < file.size,
                  );
                  return (
                    <div
                      key={row}
                      role="row"
                      className="flex gap-3 px-3 whitespace-pre"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <span className="text-muted-foreground select-none">
                        {hex(base, offsetDigits)}
                      </span>
                      <span className="flex">
                        {cells.map((offset, i) => {
                          const b = byteAt(offset);
                          const kind = regionAt(regions, offset)?.kind;
                          return (
                            <span
                              key={offset}
                              role="gridcell"
                              aria-selected={offset === selected || inRange(offset)}
                              onClick={(event) => pick(offset, event.shiftKey)}
                              className={cn(
                                'cursor-pointer px-[3px]',
                                i === 8 && 'ml-2',
                                kind && KIND_CLASS[kind],
                                inRange(offset) && 'bg-primary/30 text-foreground',
                                inField(offset) &&
                                  'underline decoration-primary decoration-2 underline-offset-4',
                                offset === selected &&
                                  'outline-2 -outline-offset-1 outline-primary',
                              )}
                            >
                              {b === null ? '··' : hex(b, 2)}
                            </span>
                          );
                        })}
                      </span>
                      <span className="flex text-muted-foreground" aria-hidden="true">
                        {cells.map((offset) => {
                          const b = byteAt(offset);
                          return (
                            <span
                              key={offset}
                              onClick={(event) => pick(offset, event.shiftKey)}
                              className={cn(
                                'w-[1ch] cursor-pointer',
                                inRange(offset) && 'bg-primary/30 text-foreground',
                                offset === selected && 'bg-primary text-primary-foreground',
                              )}
                            >
                              {b === null ? ' ' : printable(b)}
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <MiniMap
          regions={regions}
          size={file.size}
          viewFrom={firstRow * perRow}
          viewTo={(firstRow + visibleRows) * perRow}
          height={VIEW_HEIGHT}
          onJump={show}
        />
      </div>

      <div aria-live="polite" className="rounded-lg bg-muted/50 p-3 text-sm">
        <p className="font-mono">
          {t('workshop.hex.position', {
            hex: `0x${hex(selected, 2)}`,
            dec: selected.toLocaleString(i18n.language),
          })}
          {selectedByte !== null &&
            ` · ${t('workshop.hex.value', {
              hex: hex(selectedByte, 2),
              dec: selectedByte,
              bin: selectedByte.toString(2).padStart(8, '0'),
              char: printable(selectedByte),
            })}`}
        </p>
        {range && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="font-mono">
              {t('workshop.hex.range', {
                from: `0x${hex(range.from, 2)}`,
                to: `0x${hex(range.to, 2)}`,
                size: formatBytes(range.to - range.from + 1, i18n.language),
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                saveBlob(
                  file.slice(range.from, range.to + 1),
                  `${file.name.replace(/\.[^.]+$/, '')}_0x${hex(range.from, 2)}-0x${hex(range.to, 2)}.bin`,
                )
              }
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.hex.saveRange')}
            </Button>
          </div>
        )}
        {selectedRegion ? (
          <p className="mt-1">
            <span className="font-medium">
              {t(`workshop.hex.kinds.${selectedRegion.kind}`)}
              {selectedRegion.label && ` „${selectedRegion.label}“`}:
            </span>{' '}
            {regionText(t, selectedRegion, i18n.language)}
          </p>
        ) : (
          structure && <p className="mt-1 text-muted-foreground">{t('workshop.hex.noRegion')}</p>
        )}
        {selectedRegion?.fields && selectedRegion.fields.length > 0 && (
          <FieldTable fields={selectedRegion.fields} selected={selected} onPick={show} />
        )}
      </div>

      {inspected.length > 0 && (
        <DataInspector bytes={Uint8Array.from(inspected)} offset={inspectFrom} />
      )}

      {!structure && (
        <p className="text-sm text-muted-foreground">{t('workshop.hex.unknownStructure')}</p>
      )}

      {structure && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('workshop.hex.structureTitle')}</h3>
          <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('workshop.hex.legend')}>
            {REGION_KINDS.filter((k) => regions.some((r) => r.kind === k)).map((kind) => (
              <li key={kind} className={cn('rounded border px-1.5 py-0.5', KIND_CLASS[kind])}>
                {t(`workshop.hex.kinds.${kind}`)}
              </li>
            ))}
          </ul>
          <ol className="max-h-72 divide-y overflow-y-auto rounded-lg border text-sm">
            {listed.map((region) => (
              <li key={`${region.start}-${region.key}`}>
                <button
                  type="button"
                  onClick={() => show(region.start)}
                  className={cn(
                    'flex w-full items-baseline gap-3 px-3 py-1.5 text-left hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none',
                    selectedRegion === region && 'bg-muted',
                  )}
                >
                  <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                    0x{hex(region.start, 2)}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 text-xs',
                      KIND_CLASS[region.kind] || 'bg-muted',
                    )}
                  >
                    {region.label ?? t(`workshop.hex.kinds.${region.kind}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {regionText(t, region, i18n.language)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatBytes(region.end - region.start, i18n.language)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {(regions.length > listed.length || structure.truncated) && (
            <p className="text-sm text-muted-foreground">{t('workshop.hex.moreRegions')}</p>
          )}
        </section>
      )}
    </div>
  );
}
