import { useRef, useState } from 'react';
import { MaximizeIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const MIN = 0.25;
const MAX = 16;

/** An image with zoom (buttons, mouse wheel) and panning (drag). */
export function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // How much the picture is enlarged to fit (small icons, pixel art …).
  const [fitScale, setFitScale] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const zoomBy = (factor: number) => setZoom((z) => Math.min(MAX, Math.max(MIN, z * factor)));
  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="space-y-2">
      <div
        className="relative flex h-[60vh] touch-none items-center justify-center overflow-hidden rounded-md border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2)}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
        }}
        onPointerUp={() => (drag.current = null)}
        data-testid="image-preview"
      >
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="h-full w-full object-contain select-none"
          onLoad={(e) => {
            const img = e.currentTarget;
            const scale = Math.min(
              img.clientWidth / img.naturalWidth,
              img.clientHeight / img.naturalHeight,
            );
            setFitScale(Number.isFinite(scale) ? scale : 1);
          }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            // Show single pixels sharply when zoomed in.
            imageRendering: zoom * fitScale > 1.5 ? 'pixelated' : 'auto',
          }}
        />
      </div>
      <div className="flex items-center justify-center gap-1">
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => zoomBy(1 / 1.5)}
          aria-label={t('preview.zoomOut')}
        >
          <ZoomOutIcon aria-hidden="true" />
        </Button>
        <span className="w-14 text-center text-sm tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)} %
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => zoomBy(1.5)}
          aria-label={t('preview.zoomIn')}
        >
          <ZoomInIcon aria-hidden="true" />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={reset} aria-label={t('preview.fit')}>
          <MaximizeIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
