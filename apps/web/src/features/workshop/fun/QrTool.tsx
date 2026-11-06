import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2Icon,
  DownloadIcon,
  ImagePlusIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import {
  QR_KINDS,
  contactPayload,
  readQrContent,
  wifiPayload,
  type ContactData,
  type QrKind,
  type QrMeaning,
  type WifiData,
  type WifiSecurity,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FoundCode } from '@/workers/fun.worker';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { funWorker } from './fun-worker';
import { QrTooLongError, brightness, qrMatrix, qrPng, qrSvg, type QrStyle } from './qr-render';
import { usePreview } from './use-preview';

const TEXTAREA = 'min-h-24 w-full rounded-md border bg-transparent p-2 text-sm';
const SIZES = [256, 512, 1024, 2048];
const LOGO_MAX_BYTES = 10 * 1024 * 1024;

/** QR-Codes: make one (text, WLAN, contact – with a logo if you like) or read one. */
export function QrTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="qr" />
      <Tabs defaultValue="create" className="gap-4">
        <TabsList>
          <TabsTrigger value="create">{t('workshop.qr.createTab')}</TabsTrigger>
          <TabsTrigger value="read">{t('workshop.qr.readTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="create" forceMount className="data-[state=inactive]:hidden">
          <CreateQr />
        </TabsContent>
        <TabsContent value="read" forceMount className="data-[state=inactive]:hidden">
          <ReadQr />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** A picture as a small PNG data URL – also turns SVG logos into plain pixels. */
async function logoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

interface Made {
  png: Blob;
  url: string;
  text: string;
  style: QrStyle;
  /** The finished picture was read back successfully. */
  readable: boolean;
}

function CreateQr() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<QrKind>('text');
  const [text, setText] = useState('');
  const [wifi, setWifi] = useState<WifiData>({
    ssid: '',
    password: '',
    security: 'WPA',
    hidden: false,
  });
  const [contact, setContact] = useState<ContactData>({
    name: '',
    phone: '',
    email: '',
    org: '',
    url: '',
  });
  const [foreground, setForeground] = useState('#000000');
  const [background, setBackground] = useState('#ffffff');
  const [size, setSize] = useState(1024);
  const [logo, setLogo] = useState<{ name: string; url: string } | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const payload =
    kind === 'wifi'
      ? wifi.ssid.trim()
        ? wifiPayload(wifi)
        : ''
      : kind === 'contact'
        ? contact.name.trim()
          ? contactPayload(contact)
          : ''
        : text;
  const style: QrStyle = { foreground, background, size, logo: logo?.url ?? null };
  const key = payload
    ? JSON.stringify([payload, foreground, background, size, logo?.name ?? '', logo?.url.length])
    : null;

  const { result, working } = usePreview<Made>(
    key,
    async () => {
      try {
        const matrix = await qrMatrix(payload, style.logo !== null);
        const png = await qrPng(matrix, style);
        const found = await funWorker().readCodes(png);
        setTooLong(false);
        return {
          png,
          url: URL.createObjectURL(png),
          text: payload,
          style,
          readable: found.some((f) => f.text === payload),
        };
      } catch (e) {
        if (e instanceof QrTooLongError) setTooLong(true);
        return null;
      }
    },
    (old) => URL.revokeObjectURL(old.url),
    200,
  );
  const shown = key ? result : null;
  // Light on dark is "inverted" – many scanner apps can't read that.
  const lowContrast = brightness(foreground) > brightness(background) - 0.4;

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoError(false);
    try {
      if (file.size > LOGO_MAX_BYTES) throw new Error('too big');
      setLogo({ name: `${file.name}-${file.size}`, url: await logoDataUrl(file) });
    } catch {
      setLogoError(true);
    }
  };

  const saveSvg = async () => {
    if (!shown) return;
    const svg = await qrSvg(await qrMatrix(shown.text, shown.style.logo !== null), shown.style);
    saveBlob(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg');
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="qr-kind">{t('workshop.qr.kind')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as QrKind)}>
            <SelectTrigger id="qr-kind" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QR_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`workshop.qr.kinds.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {kind === 'text' && (
          <div className="space-y-2">
            <Label htmlFor="qr-text">{t('workshop.qr.text')}</Label>
            <textarea
              id="qr-text"
              className={TEXTAREA}
              placeholder={t('workshop.qr.textPlaceholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        {kind === 'wifi' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="qr-ssid" label={t('workshop.qr.ssid')}>
              <Input
                id="qr-ssid"
                value={wifi.ssid}
                onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })}
              />
            </Field>
            <Field id="qr-security" label={t('workshop.qr.security')}>
              <Select
                value={wifi.security}
                onValueChange={(v) => setWifi({ ...wifi, security: v as WifiSecurity })}
              >
                <SelectTrigger id="qr-security" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['WPA', 'WEP', 'nopass'] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`workshop.qr.securities.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {wifi.security !== 'nopass' && (
              <Field id="qr-password" label={t('workshop.qr.password')}>
                <Input
                  id="qr-password"
                  autoComplete="off"
                  value={wifi.password}
                  onChange={(e) => setWifi({ ...wifi, password: e.target.value })}
                />
              </Field>
            )}
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch
                id="qr-hidden"
                checked={wifi.hidden}
                onCheckedChange={(hidden) => setWifi({ ...wifi, hidden })}
              />
              <Label htmlFor="qr-hidden" className="flex items-center gap-1">
                {t('workshop.qr.hidden')}
                <HelpTip helpKey="workshop.qr.hiddenHelp" labelKey="workshop.qr.hidden" />
              </Label>
            </div>
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:col-span-2">
              {t('workshop.qr.wifiWarning')}
            </p>
          </div>
        )}

        {kind === 'contact' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['name', 'phone', 'email', 'org', 'url'] as const).map((field) => (
              <Field key={field} id={`qr-${field}`} label={t(`workshop.qr.contact.${field}`)}>
                <Input
                  id={`qr-${field}`}
                  type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                  value={contact[field]}
                  onChange={(e) => setContact({ ...contact, [field]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="qr-fg" label={t('workshop.qr.foreground')}>
            <Input
              id="qr-fg"
              type="color"
              className="h-9 w-full p-1"
              value={foreground}
              onChange={(e) => setForeground(e.target.value)}
            />
          </Field>
          <Field id="qr-bg" label={t('workshop.qr.background')}>
            <Input
              id="qr-bg"
              type="color"
              className="h-9 w-full p-1"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            />
          </Field>
          <Field id="qr-size" label={t('workshop.qr.size')}>
            <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
              <SelectTrigger id="qr-size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} × {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {lowContrast && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('workshop.qr.lowContrast')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => logoInput.current?.click()}>
            <ImagePlusIcon aria-hidden="true" />
            {t(logo ? 'workshop.qr.logoReplace' : 'workshop.qr.logo')}
          </Button>
          {logo && (
            <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
              <XIcon aria-hidden="true" />
              {t('workshop.qr.logoRemove')}
            </Button>
          )}
          <HelpTip helpKey="workshop.qr.logoHelp" labelKey="workshop.qr.logo" />
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void chooseLogo(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {logoError && (
          <p role="alert" className="text-sm text-destructive">
            {t('workshop.qr.logoFailed')}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex aspect-square items-center justify-center rounded-xl border bg-muted/30 p-3">
          {shown ? (
            <img
              src={shown.url}
              alt={t('workshop.qr.resultAlt')}
              className="max-h-full max-w-full [image-rendering:pixelated]"
            />
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {tooLong && payload ? t('workshop.qr.tooLong') : t('workshop.qr.empty')}
            </p>
          )}
        </div>
        {working && key && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t('workshop.fun.working')}
          </p>
        )}
        {shown && !working && (
          <p
            className={
              shown.readable
                ? 'flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400'
                : 'flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300'
            }
          >
            {shown.readable ? (
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            {t(shown.readable ? 'workshop.qr.readable' : 'workshop.qr.unreadable')}
          </p>
        )}
        {shown && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => saveBlob(shown.png, 'qr-code.png')}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.fun.save', { ext: 'PNG' })}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void saveSvg()}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.qr.saveSvg')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

function ReadQr() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const key = file ? `${file.name}-${file.size}-${file.lastModified}` : null;
  const { result, working, failed } = usePreview<FoundCode[]>(
    key,
    () => (file ? funWorker().readCodes(file) : Promise.resolve(null)),
    undefined,
    0,
  );

  return (
    <div className="space-y-4">
      <SingleFile file={file} onFile={setFile} />
      {!hasDetector && <p className="text-xs text-muted-foreground">{t('workshop.qr.onlyQr')}</p>}
      {working && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.qr.searching')}
        </p>
      )}
      {file && !working && (failed || result?.length === 0) && (
        <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          {t('workshop.qr.noneFound')}
        </p>
      )}
      {file && !working && result && result.length > 0 && (
        <ul className="space-y-3">
          {result.map((code, i) => (
            <li key={i} className="space-y-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {code.format === 'qr_code'
                  ? t('workshop.qr.formatQr')
                  : t('workshop.qr.formatBarcode', { format: code.format.toUpperCase() })}
              </p>
              <Meaning meaning={readQrContent(code.text)} raw={code.text} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the code says, in plain words – links are shown, never opened by themselves. */
function Meaning({ meaning, raw }: { meaning: QrMeaning; raw: string }) {
  const { t } = useTranslation();
  const row = (label: string, value: string) =>
    value ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-28 text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 font-medium break-all">{value}</span>
        <CopyButton text={value} label={t('workshop.qr.copy')} />
      </div>
    ) : null;

  switch (meaning.kind) {
    case 'url':
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.url')}</p>
          <p className="text-sm break-all">
            <a href={meaning.url} target="_blank" rel="noopener noreferrer" className="underline">
              {meaning.url}
            </a>
          </p>
          <p className="text-xs text-muted-foreground">{t('workshop.qr.urlWarning')}</p>
          <CopyButton text={meaning.url} label={t('workshop.qr.copy')} />
        </div>
      );
    case 'wifi':
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.wifi')}</p>
          {row(t('workshop.qr.ssid'), meaning.wifi.ssid)}
          {row(t('workshop.qr.password'), meaning.wifi.password)}
          <p className="text-sm text-muted-foreground">
            {t(`workshop.qr.securities.${meaning.wifi.security}`)}
          </p>
        </div>
      );
    case 'contact':
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.contact')}</p>
          {(['name', 'phone', 'email', 'org', 'url'] as const).map((f) => (
            <div key={f}>{row(t(`workshop.qr.contact.${f}`), meaning.contact[f])}</div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              saveBlob(
                new Blob([meaning.vcard], { type: 'text/vcard;charset=utf-8' }),
                'contact.vcf',
              )
            }
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.qr.saveVcf')}
          </Button>
        </div>
      );
    case 'email':
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.email')}</p>
          {row(t('workshop.qr.contact.email'), meaning.address)}
        </div>
      );
    case 'phone':
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.phone')}</p>
          {row(t('workshop.qr.contact.phone'), meaning.number)}
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('workshop.qr.meaning.text')}</p>
          <pre className="max-h-60 overflow-auto rounded border bg-muted/30 p-2 text-sm whitespace-pre-wrap">
            {raw}
          </pre>
          <CopyButton text={raw} label={t('workshop.qr.copy')} />
        </div>
      );
  }
}
