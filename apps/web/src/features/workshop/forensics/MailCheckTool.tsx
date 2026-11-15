import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  PaperclipIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import {
  checkEmail,
  emlText,
  type AuthResult,
  type MailReport,
  type MailSeverity,
} from '@conbert/core';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';

/** Emails above this size are mostly attachments – the headers are at the start anyway. */
const MAX_BYTES = 64 * 1024 * 1024;

const SEVERITY_CLASS: Record<MailSeverity, string> = {
  high: 'border-red-500/40 bg-red-500/10',
  medium: 'border-amber-500/40 bg-amber-500/10',
  info: 'border-border bg-muted/30',
};

const AUTH_CLASS = (r: AuthResult | null) =>
  r === 'pass'
    ? 'text-emerald-700 dark:text-emerald-400'
    : r === 'fail' || r === 'softfail'
      ? 'text-red-700 dark:text-red-400'
      : 'text-muted-foreground';

/** E-Mail-Prüfer – what a saved email really says about its sender, links and attachments. */
export function MailCheckTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ file: File; r: MailReport } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const r = report && report.file === file ? report.r : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    file
      .slice(0, MAX_BYTES)
      .arrayBuffer()
      .then((buf) => {
        const raw = emlText(new Uint8Array(buf));
        // An email starts with header lines ("Name: value").
        if (!/^[\w-]+:/m.test(raw.slice(0, 2000))) throw new Error('not an email');
        if (active) setReport({ file, r: checkEmail(raw) });
      })
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const date = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' }).format(
          d,
        )
      : '–';
  const VerdictIcon =
    r?.verdict === 'danger'
      ? ShieldAlertIcon
      : r?.verdict === 'caution'
        ? AlertTriangleIcon
        : CheckCircle2Icon;

  return (
    <div className="space-y-4">
      <HowItWorks trick="mailcheck" />
      <SingleFile file={file} onFile={setFile} />
      <p className="text-xs text-muted-foreground">{t('workshop.mailcheck.howToSave')}</p>
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.mailcheck.failed')}
        </p>
      )}
      {r && (
        <div className="space-y-5">
          <div
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-sm',
              r.verdict === 'danger'
                ? SEVERITY_CLASS.high
                : r.verdict === 'caution'
                  ? SEVERITY_CLASS.medium
                  : 'border-emerald-500/40 bg-emerald-500/10',
            )}
            data-testid="mailcheck-verdict"
          >
            <VerdictIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>{t(`workshop.mailcheck.verdict.${r.verdict}`)}</p>
          </div>

          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('workshop.mailcheck.fields.from')}</dt>
            <dd className="break-all">
              {r.from ? (
                <>
                  {r.from.name && <span className="font-medium">{r.from.name} </span>}
                  <span className="font-mono">&lt;{r.from.address}&gt;</span>
                </>
              ) : (
                '–'
              )}
            </dd>
            {r.replyTo && (
              <>
                <dt className="text-muted-foreground">{t('workshop.mailcheck.fields.replyTo')}</dt>
                <dd className="font-mono break-all">{r.replyTo.address}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('workshop.mailcheck.fields.to')}</dt>
            <dd className="break-all">{r.to || '–'}</dd>
            <dt className="text-muted-foreground">{t('workshop.mailcheck.fields.subject')}</dt>
            <dd className="break-words">{r.subject || '–'}</dd>
            <dt className="text-muted-foreground">{t('workshop.mailcheck.fields.date')}</dt>
            <dd>{date(r.date)}</dd>
          </dl>

          <section className="space-y-2">
            <h3 className="font-medium">{t('workshop.mailcheck.findings')}</h3>
            {r.warnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('workshop.mailcheck.nothing')}</p>
            ) : (
              <ul className="space-y-2" data-testid="mailcheck-warnings">
                {r.warnings.map((w) => (
                  <li
                    key={w.key}
                    className={cn(
                      'space-y-1 rounded-lg border p-3 text-sm',
                      SEVERITY_CLASS[w.severity],
                    )}
                  >
                    <p className="flex items-center gap-2 font-medium">
                      {w.severity === 'info' ? (
                        <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      {t(`workshop.mailcheck.warnings.${w.key}.title`, w.values)}
                      <Badge variant="outline" className="ml-auto">
                        {t(`workshop.mailcheck.severity.${w.severity}`)}
                      </Badge>
                    </p>
                    <p className="break-words text-muted-foreground">
                      {t(`workshop.mailcheck.warnings.${w.key}.help`, w.values)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">{t('workshop.mailcheck.authTitle')}</h3>
            <ul className="space-y-1 text-sm">
              {(['spf', 'dkim', 'dmarc'] as const).map((k) => (
                <li key={k} className="flex flex-wrap gap-x-2">
                  <span className="w-14 font-mono font-medium uppercase">{k}</span>
                  <span className={cn('w-28 font-medium', AUTH_CLASS(r.auth[k]))}>
                    {t(`workshop.mailcheck.authResult.${r.auth[k] ?? 'missing'}`)}
                  </span>
                  <span className="flex-1 text-muted-foreground">
                    {t(`workshop.mailcheck.authHelp.${k}`)}
                  </span>
                </li>
              ))}
            </ul>
            {r.auth.by && (
              <p className="text-xs text-muted-foreground">
                {t('workshop.mailcheck.authBy', { by: r.auth.by })}
              </p>
            )}
          </section>

          {r.hops.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">{t('workshop.mailcheck.routeTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('workshop.mailcheck.routeHelp')}</p>
              <ol className="space-y-1 text-sm">
                {r.hops.map((h, i) => (
                  <li key={i} className="rounded-md border px-3 py-1.5">
                    <span className="font-mono text-xs break-all">
                      {h.from || '?'} → {h.by || '?'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {date(h.date)}
                      {h.delay !== null &&
                        ` · ${t('workshop.mailcheck.delay', { count: h.delay })}`}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {r.links.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">
                {t('workshop.mailcheck.linksTitle', { count: r.links.length })}
              </h3>
              <p className="text-xs text-muted-foreground">{t('workshop.mailcheck.linksHelp')}</p>
              <ul className="space-y-1 text-sm">
                {r.links.slice(0, 100).map((l, i) => (
                  <li key={i} className="rounded-md border px-3 py-1.5">
                    <span className="font-medium">{l.domain || '?'}</span>
                    {l.text && (
                      <span className="text-muted-foreground"> · „{l.text.slice(0, 80)}“</span>
                    )}
                    <span className="block font-mono text-xs break-all text-muted-foreground">
                      {l.url}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.attachments.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">{t('workshop.mailcheck.attachmentsTitle')}</h3>
              <ul className="space-y-1 text-sm">
                {r.attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                    <PaperclipIcon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-all">{a.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.type} · {formatBytes(a.size, i18n.language)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.text && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {t('workshop.mailcheck.textTitle')}
              </summary>
              <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                {r.text}
              </p>
            </details>
          )}
          <p className="text-xs text-muted-foreground">{t('workshop.mailcheck.limits')}</p>
        </div>
      )}
    </div>
  );
}
