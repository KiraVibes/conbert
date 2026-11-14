import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeOffIcon, LockKeyholeIcon, Loader2Icon, Trash2Icon, XIcon } from 'lucide-react';
import { ConversionError } from '@conbert/core';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WATERMARK_POSITIONS, type WatermarkPosition } from './pdf-finish';
import type { PageRef, PdfSource, Rect } from './pdf-ops';
import { renderPageCanvas } from './page-thumbs';
import { usePdfTool } from './pdf-store';

// --- Black out ---------------------------------------------------------------

/** Boxes smaller than this (fraction of the page) are treated as a slip of the mouse. */
const MIN_SIZE = 0.005;

/** Draw black boxes over a page: drag with the mouse or a finger. */
export function RedactDialog({
  page,
  source,
  open,
  onOpenChange,
}: {
  page: PageRef;
  source: PdfSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [rects, setRects] = useState<Rect[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let made: string | null = null;
    void renderPageCanvas(source, page.index, 1100).then(({ canvas }) =>
      canvas.toBlob((blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      }, 'image/png'),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [open, source, page.index]);

  // Opening again starts from what the page has.
  const [shownFor, setShownFor] = useState<boolean>(false);
  if (open !== shownFor) {
    setShownFor(open);
    if (open) setRects([...(page.redactions ?? [])]);
  }

  const point = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const span = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('pdf.redact.title')}</DialogTitle>
          <DialogDescription>{t('pdf.redact.intro')}</DialogDescription>
        </DialogHeader>
        <div
          ref={box}
          className="relative mx-auto w-fit max-w-full touch-none overflow-hidden rounded border bg-muted select-none"
          style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            start.current = point(e);
            setDraft({ ...start.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (start.current) setDraft(span(start.current, point(e)));
          }}
          onPointerUp={(e) => {
            if (!start.current) return;
            const r = span(start.current, point(e));
            start.current = null;
            setDraft(null);
            if (r.w > MIN_SIZE && r.h > MIN_SIZE) setRects((old) => [...old, r]);
          }}
        >
          {url ? (
            <img
              src={url}
              alt={t('pdf.redact.pageAlt')}
              className="block h-auto max-h-[65vh] w-auto max-w-full"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-[3/4] w-64 items-center justify-center">
              <Loader2Icon
                className="size-6 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          )}
          {[...rects, ...(draft ? [draft] : [])].map((r, i) => (
            <div
              key={i}
              className="absolute bg-black"
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                opacity: r === draft ? 0.6 : 1,
              }}
            >
              {r !== draft && (
                <button
                  type="button"
                  className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow"
                  aria-label={t('pdf.redact.removeOne', { n: i + 1 })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setRects((old) => old.filter((_, j) => j !== i))}
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t('pdf.redact.howItWorks')}</p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={rects.length === 0} onClick={() => setRects([])}>
            <Trash2Icon aria-hidden="true" />
            {t('pdf.redact.clear')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('pdf.redact.cancel')}
            </Button>
            <Button
              onClick={() => {
                usePdfTool.getState().setRedactions(page.id, rects);
                onOpenChange(false);
              }}
            >
              {t('pdf.redact.apply', { count: rects.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Locked PDFs ---------------------------------------------------------------

function LockedRow({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ messageKey: string; details?: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await usePdfTool.getState().unlock(id, password);
    } catch (err) {
      setError(
        err instanceof ConversionError
          ? { messageKey: err.messageKey, ...(err.details && { details: err.details }) }
          : { messageKey: 'errors.pdfBroken', details: String(err) },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <LockKeyholeIcon className="size-4" aria-hidden="true" />
        {t('pdf.locked.title', { name })}
      </p>
      <p className="text-sm text-muted-foreground">{t('pdf.locked.help')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label={t('pdf.locked.passwordFor', { name })}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={!password || busy}>
          {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {t('pdf.locked.open')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => usePdfTool.getState().dismissLocked(id)}
        >
          {t('pdf.locked.skip')}
        </Button>
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </form>
  );
}

export function LockedFiles() {
  const locked = usePdfTool((s) => s.locked);
  if (locked.length === 0) return null;
  return (
    <div className="space-y-2">
      {locked.map((f) => (
        <LockedRow key={f.id} id={f.id} name={f.name} />
      ))}
    </div>
  );
}

// --- Watermark & password ------------------------------------------------------

export interface ProtectSettings {
  watermark: string;
  position: WatermarkPosition;
  password: string;
}

export function ProtectSection({
  value,
  onChange,
  disabled,
}: {
  value: ProtectSettings;
  onChange: (next: ProtectSettings) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 font-medium">{t('pdf.protect.label')}</legend>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="pdf-watermark" className="flex items-center gap-1">
            {t('pdf.protect.watermark')}
            <HelpTip helpKey="pdf.protect.watermarkHelp" labelKey="pdf.protect.watermark" />
          </Label>
          <Input
            id="pdf-watermark"
            value={value.watermark}
            maxLength={80}
            placeholder={t('pdf.protect.watermarkPlaceholder')}
            onChange={(e) => onChange({ ...value, watermark: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pdf-watermark-position">{t('pdf.protect.position')}</Label>
          <Select
            value={value.position}
            onValueChange={(v) => onChange({ ...value, position: v as WatermarkPosition })}
          >
            <SelectTrigger id="pdf-watermark-position" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WATERMARK_POSITIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`pdf.protect.positions.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pdf-password" className="flex items-center gap-1">
          {t('pdf.protect.password')}
          <HelpTip helpKey="pdf.protect.passwordHelp" labelKey="pdf.protect.password" />
        </Label>
        <div className="flex max-w-sm items-center gap-1">
          <Input
            id="pdf-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={value.password}
            maxLength={128}
            onChange={(e) =>
              onChange({ ...value, password: e.target.value.replace(/[\r\n]/g, '') })
            }
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setShow((s) => !s)}
            aria-label={t(show ? 'pdf.protect.hide' : 'pdf.protect.show')}
            title={t(show ? 'pdf.protect.hide' : 'pdf.protect.show')}
          >
            {show ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
        </div>
        {value.password && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('pdf.protect.remember')}</p>
        )}
      </div>
    </fieldset>
  );
}
