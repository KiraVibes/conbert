import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, LockIcon, PackageOpenIcon, XIcon } from 'lucide-react';
import {
  isPackageHtml,
  openPackageHtml,
  packageHtml,
  PACKAGE_MAX_BYTES,
  PACKAGE_WARN_BYTES,
  sealContent,
  type PackageContent,
  type PackageTexts,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/features/convert/Dropzone';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

const MODES = ['pack', 'open'] as const;
type Mode = (typeof MODES)[number];

/** Passwort-Paket – files locked into one HTML page that opens with a password. */
export function PasswordPackageTool() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('pack');
  return (
    <div className="space-y-4">
      <HowItWorks trick="passwordpack" />
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={t('workshop.passwordpack.mode')}
      >
        {MODES.map((m) => (
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
            {t(`workshop.passwordpack.modes.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'pack' ? <Pack /> : <Open />}
    </div>
  );
}

function Pack() {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const total = files.reduce((s, f) => s + f.size, 0);
  const size = (n: number) => formatBytes(n, i18n.language);
  const tooBig = total > PACKAGE_MAX_BYTES;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = files.length > 0 && password.length > 0 && password === repeat && !tooBig && !busy;

  async function make() {
    setBusy(true);
    setFailed(false);
    setDone(null);
    try {
      const p = (k: string) => t(`workshop.passwordpack.page.${k}`);
      const texts: PackageTexts = {
        lang: i18n.language,
        heading: p('heading'),
        intro: p('intro'),
        hintLabel: p('hintLabel'),
        password: p('password'),
        open: p('open'),
        opening: p('opening'),
        wrong: p('wrong'),
        noCrypto: p('noCrypto'),
        message: p('message'),
        files: p('files'),
        save: p('save'),
        saveAll: p('saveAll'),
        footer: p('footer'),
      };
      const content: PackageContent = {
        message: message.trim(),
        files: await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.type,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        ),
      };
      const sealed = await sealContent(content, password);
      const html = packageHtml(sealed, texts, title.trim(), hint.trim());
      const blob = new Blob([html], { type: 'text/html' });
      const name = (title.trim() || t('workshop.passwordpack.defaultName')).replace(
        /[\\/:*?"<>|]+/g,
        '_',
      );
      saveBlob(blob, `${name}.html`);
      setDone(blob.size);
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Dropzone compact onFiles={(added) => setFiles((prev) => [...prev, ...added])} />
      {files.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="package-files">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground tabular-nums">{size(f.size)}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('workshop.passwordpack.remove', { name: f.name })}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
          <li className="text-xs text-muted-foreground">
            {t('workshop.passwordpack.total', { count: files.length, size: size(total) })}
          </li>
        </ul>
      )}
      {tooBig && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.passwordpack.tooBig', { max: size(PACKAGE_MAX_BYTES) })}
        </p>
      )}
      {!tooBig && total > PACKAGE_WARN_BYTES && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('workshop.passwordpack.big')}
        </p>
      )}
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pp-title">{t('workshop.passwordpack.title')}</Label>
          <Input
            id="pp-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('workshop.passwordpack.visible')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-hint">{t('workshop.passwordpack.hint')}</Label>
          <Input
            id="pp-hint"
            value={hint}
            maxLength={200}
            onChange={(e) => setHint(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('workshop.passwordpack.visible')}</p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="pp-message">{t('workshop.passwordpack.message')}</Label>
          <textarea
            id="pp-message"
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <p className="text-xs text-muted-foreground">{t('workshop.passwordpack.messageHelp')}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-password">{t('workshop.passwordpack.password')}</Label>
          <Input
            id="pp-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password.length > 0 && password.length < 10 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('workshop.passwordpack.weak')}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-repeat">{t('workshop.passwordpack.repeat')}</Label>
          <Input
            id="pp-repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            aria-invalid={mismatch}
          />
          {mismatch && (
            <p className="text-xs text-destructive">{t('workshop.passwordpack.mismatch')}</p>
          )}
        </div>
      </div>
      <Button onClick={() => void make()} disabled={!ready}>
        {busy ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <LockIcon aria-hidden="true" />
        )}
        {busy ? t('workshop.passwordpack.making') : t('workshop.passwordpack.make')}
      </Button>
      {done !== null && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"
        >
          {t('workshop.passwordpack.done', { size: size(done) })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.passwordpack.failed')}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('workshop.passwordpack.sendTip')}</p>
    </div>
  );
}

function Open() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [content, setContent] = useState<PackageContent | null>(null);
  const [error, setError] = useState<'notPackage' | 'wrong' | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const html = await file.text();
      if (!isPackageHtml(html)) {
        setError('notPackage');
        return;
      }
      setContent(await openPackageHtml(html, password));
    } catch {
      setError('wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setContent(null);
          setError(null);
        }}
      />
      {file && !content && (
        <form
          className="flex max-w-md flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="pp-open-password">{t('workshop.passwordpack.password')}</Label>
            <Input
              id="pp-open-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || password.length === 0}>
            {busy ? (
              <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <PackageOpenIcon aria-hidden="true" />
            )}
            {t('workshop.passwordpack.page.open')}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`workshop.passwordpack.errors.${error}`)}
        </p>
      )}
      {content && (
        <div className="space-y-3" data-testid="package-content">
          {content.message && (
            <div className="space-y-1">
              <h3 className="font-medium">{t('workshop.passwordpack.page.message')}</h3>
              <p className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                {content.message}
              </p>
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {content.files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatBytes(f.bytes.length, i18n.language)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    saveBlob(
                      new Blob([f.bytes as Uint8Array<ArrayBuffer>], {
                        type: f.type || 'application/octet-stream',
                      }),
                      f.name,
                    )
                  }
                >
                  <DownloadIcon aria-hidden="true" />
                  {t('workshop.passwordpack.page.save')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
