import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import {
  ICNS_TYPES,
  ICO_SIZES,
  buildIcns,
  buildIco,
  faviconHtml,
  webManifest,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { createZip } from '@/lib/zip';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { FunSlider } from './FunParts';
import { funWorker } from './fun-worker';
import { usePreview } from './use-preview';

type Fit = 'contain' | 'cover';
const PREVIEW_SIZES = [16, 32, 48, 180] as const;

interface Options {
  fit: Fit;
  padding: number;
  /** Fill see-through parts (null = keep them see-through). */
  background: string | null;
  color: string;
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** Phones show home-screen icons without see-through parts: always filled. */
function render(file: File, size: number, o: Options, filled = false, extraPadding = 0) {
  return funWorker().renderIcon(
    file,
    size,
    Math.min(0.4, o.padding + extraPadding),
    filled ? o.color : o.background,
    o.fit,
  );
}

/** Icon- & Favicon-Generator: one picture → favicon.ico, app icons, ICNS and manifest. */
export function FaviconTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [fit, setFit] = useState<Fit>('contain');
  const [padding, setPadding] = useState(0);
  const [fill, setFill] = useState(false);
  const [color, setColor] = useState('#ffffff');
  const [name, setName] = useState('');
  const [themeColor, setThemeColor] = useState('#6d28d9');
  const [icns, setIcns] = useState(true);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState(false);
  const options: Options = { fit, padding: padding / 100, background: fill ? color : null, color };
  const key = file ? JSON.stringify([file.name, file.size, fit, padding, fill, color]) : null;

  const preview = usePreview<{ size: number; url: string }[]>(
    key,
    async () => {
      if (!file) return null;
      return Promise.all(
        PREVIEW_SIZES.map(async (size) => ({
          size,
          url: URL.createObjectURL(await render(file, size, options, size === 180)),
        })),
      );
    },
    (old) => old.forEach((p) => URL.revokeObjectURL(p.url)),
  );

  const snippet = faviconHtml(themeColor);
  const appName = name.trim() || file?.name.replace(/\.[^.]+$/, '') || 'App';

  const buildPackage = async () => {
    if (!file) return;
    setBuilding(true);
    setFailed(false);
    try {
      const sizes = [...new Set([...ICO_SIZES, ...ICNS_TYPES.map((x) => x.size), 192, 512])];
      const png = new Map<number, Uint8Array>();
      for (const size of sizes) png.set(size, await bytes(await render(file, size, options)));
      const get = (size: number) => png.get(size) ?? new Uint8Array();
      const blob = (data: Uint8Array, type: string) =>
        new Blob([data as Uint8Array<ArrayBuffer>], { type });
      const entries = [
        {
          name: 'favicon.ico',
          blob: blob(buildIco(ICO_SIZES.map((size) => ({ size, png: get(size) }))), 'image/x-icon'),
        },
        { name: 'favicon-16x16.png', blob: blob(get(16), 'image/png') },
        { name: 'favicon-32x32.png', blob: blob(get(32), 'image/png') },
        { name: 'apple-touch-icon.png', blob: await render(file, 180, options, true) },
        { name: 'android-chrome-192x192.png', blob: blob(get(192), 'image/png') },
        { name: 'android-chrome-512x512.png', blob: blob(get(512), 'image/png') },
        // Android may cut the icon into a circle: keep the picture inside the middle.
        { name: 'maskable-512x512.png', blob: await render(file, 512, options, true, 0.1) },
        {
          name: 'site.webmanifest',
          blob: new Blob(
            [
              webManifest({
                name: appName,
                shortName: appName.slice(0, 12),
                themeColor,
                backgroundColor: color,
              }),
            ],
            { type: 'application/manifest+json' },
          ),
        },
        { name: 'head-snippet.html', blob: new Blob([`${snippet}\n`], { type: 'text/html' }) },
        ...(icns ? [{ name: 'app.icns', blob: blob(buildIcns(png), 'image/icns') }] : []),
      ];
      saveBlob(await createZip(entries), 'favicons.zip');
    } catch {
      setFailed(true);
    } finally {
      setBuilding(false);
    }
  };

  const saveIco = async () => {
    if (!file) return;
    try {
      const images = await Promise.all(
        ICO_SIZES.map(async (size) => ({
          size,
          png: await bytes(await render(file, size, options)),
        })),
      );
      saveBlob(
        new Blob([buildIco(images) as Uint8Array<ArrayBuffer>], { type: 'image/x-icon' }),
        'favicon.ico',
      );
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="favicon" />
      <SingleFile file={file} onFile={setFile} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            {t('workshop.favicon.fit')}
            <HelpTip helpKey="workshop.favicon.fitHelp" labelKey="workshop.favicon.fit" />
          </Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={fit}
            onValueChange={(v) => v && setFit(v as Fit)}
          >
            <ToggleGroupItem value="contain">{t('workshop.favicon.contain')}</ToggleGroupItem>
            <ToggleGroupItem value="cover">{t('workshop.favicon.cover')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <FunSlider
          label={t('workshop.favicon.padding', { value: padding })}
          labelKey="workshop.favicon.paddingLabel"
          helpKey="workshop.favicon.paddingHelp"
          value={padding}
          min={0}
          max={25}
          onChange={setPadding}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Switch id="favicon-fill" checked={fill} onCheckedChange={setFill} />
          <Label htmlFor="favicon-fill" className="flex items-center gap-1">
            {t('workshop.favicon.fill')}
            <HelpTip helpKey="workshop.favicon.fillHelp" labelKey="workshop.favicon.fill" />
          </Label>
          <Input
            type="color"
            className="h-9 w-16 p-1"
            aria-label={t('workshop.favicon.color')}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="favicon-icns" checked={icns} onCheckedChange={setIcns} />
          <Label htmlFor="favicon-icns" className="flex items-center gap-1">
            {t('workshop.favicon.icns')}
            <HelpTip helpKey="workshop.favicon.icnsHelp" labelKey="workshop.favicon.icns" />
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="favicon-name" className="flex items-center gap-1">
            {t('workshop.favicon.name')}
            <HelpTip helpKey="workshop.favicon.nameHelp" labelKey="workshop.favicon.name" />
          </Label>
          <Input
            id="favicon-name"
            maxLength={60}
            placeholder={appName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="favicon-theme" className="flex items-center gap-1">
            {t('workshop.favicon.theme')}
            <HelpTip helpKey="workshop.favicon.themeHelp" labelKey="workshop.favicon.theme" />
          </Label>
          <Input
            id="favicon-theme"
            type="color"
            className="h-9 w-16 p-1"
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value)}
          />
        </div>
      </div>

      {file && (
        <section className="space-y-3" aria-label={t('workshop.favicon.previewTitle')}>
          <h3 className="text-sm font-medium">{t('workshop.favicon.previewTitle')}</h3>
          <ul className="flex flex-wrap items-end gap-6 rounded-xl border bg-[repeating-conic-gradient(#8882_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
            {(preview.result ?? []).map((p) => (
              <li key={p.size} className="flex flex-col items-center gap-1">
                <img
                  src={p.url}
                  width={Math.min(p.size, 96)}
                  height={Math.min(p.size, 96)}
                  alt=""
                  className={p.size <= 48 ? '[image-rendering:pixelated]' : undefined}
                  style={p.size <= 48 ? { width: p.size * 2, height: p.size * 2 } : undefined}
                />
                <span className="text-xs text-muted-foreground">
                  {p.size === 180 ? t('workshop.favicon.apple') : `${p.size} × ${p.size}`}
                </span>
              </li>
            ))}
            {preview.working && (
              <li>
                <Loader2Icon
                  className="size-5 animate-spin motion-reduce:animate-none"
                  aria-label={t('workshop.fun.working')}
                />
              </li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">{t('workshop.favicon.previewHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void buildPackage()} disabled={building}>
              {building ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
              {t('workshop.favicon.savePackage')}
            </Button>
            <Button variant="outline" onClick={() => void saveIco()}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.favicon.saveIco')}
            </Button>
          </div>
          {(failed || preview.failed) && (
            <p role="alert" className="text-sm text-destructive">
              {t('workshop.fun.failed')}
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{t('workshop.favicon.snippet')}</h3>
              <HelpTip helpKey="workshop.favicon.snippetHelp" labelKey="workshop.favicon.snippet" />
              <CopyButton text={snippet} label={t('workshop.qr.copy')} />
            </div>
            <pre className="overflow-x-auto rounded border bg-muted/30 p-2 text-xs">{snippet}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
