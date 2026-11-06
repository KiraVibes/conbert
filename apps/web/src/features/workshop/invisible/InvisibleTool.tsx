import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeOffIcon, Loader2Icon, LockOpenIcon, TriangleAlertIcon } from 'lucide-react';
import {
  codePointLabel,
  countInvisible,
  findInvisible,
  guessBinaryMessage,
  hideInText,
  INVISIBLE_KINDS,
  peekHiddenText,
  revealFromText,
  StegoError,
  stripInvisible,
  type InvisibleKind,
  type InvisibleRun,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CopyButton } from '../CopyButton';
import { HowItWorks } from '../SingleFile';

const TEXTAREA = 'min-h-28 w-full rounded-md border bg-transparent p-2 text-sm';

const BADGE: Record<InvisibleKind, string> = {
  'zero-width': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  tag: 'bg-red-500/15 text-red-700 dark:text-red-300',
  variation: 'bg-red-500/15 text-red-700 dark:text-red-300',
  bidi: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  filler: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'soft-hyphen': 'bg-muted text-muted-foreground',
  space: 'bg-muted text-muted-foreground',
};

function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown) =>
    t(
      error instanceof StegoError
        ? `workshop.invisible.errors.${error.code}`
        : 'workshop.invisible.errors.damaged',
    );
}

function Hide() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [cover, setCover] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const added = result === null ? 0 : result.length - cover.length;

  const hide = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await hideInText(cover, secret, password));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void hide();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="invisible-cover">{t('workshop.invisible.cover')}</Label>
          <textarea
            id="invisible-cover"
            className={TEXTAREA}
            placeholder={t('workshop.invisible.coverPlaceholder')}
            value={cover}
            onChange={(e) => {
              setCover(e.target.value);
              setResult(null);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invisible-secret">{t('workshop.invisible.secret')}</Label>
          <textarea
            id="invisible-secret"
            className={TEXTAREA}
            placeholder={t('workshop.invisible.secretPlaceholder')}
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setResult(null);
            }}
          />
        </div>
      </div>
      <div className="max-w-sm space-y-1">
        <Label htmlFor="invisible-password" className="flex items-center gap-1">
          {t('workshop.invisible.password')}
          <HelpTip
            helpKey="workshop.invisible.passwordHelp"
            labelKey="workshop.invisible.password"
          />
        </Label>
        <Input
          id="invisible-password"
          type="password"
          autoComplete="new-password"
          placeholder={t('workshop.invisible.passwordPlaceholder')}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setResult(null);
          }}
        />
      </div>
      <Button type="submit" disabled={!cover.trim() || !secret || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <EyeOffIcon aria-hidden="true" />
        )}
        {t('workshop.invisible.hide')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result !== null && (
        <section className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 font-medium">{t('workshop.invisible.result')}</h3>
            <CopyButton text={result} label={t('workshop.invisible.copy')} />
          </div>
          <textarea
            readOnly
            aria-label={t('workshop.invisible.result')}
            data-testid="invisible-result"
            className={cn(TEXTAREA, 'min-h-16 bg-background')}
            value={result}
          />
          <p className="text-sm" role="status">
            {t('workshop.invisible.resultInfo', { count: added })}
          </p>
          <p className="flex gap-2 text-sm text-muted-foreground">
            <TriangleAlertIcon
              className="mt-0.5 size-4 shrink-0 text-amber-500"
              aria-hidden="true"
            />
            {t('workshop.invisible.appsWarning')}
          </p>
        </section>
      )}
    </form>
  );
}

/** The Conbert message in the text: opens it, with a password if needed. */
function ConbertMessage({ text, encrypted }: { text: string; encrypted: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    { text: string; message: string } | { text: string; error: string } | null
  >(null);
  const shown = outcome?.text === text ? outcome : null;

  const open = async (pass: string) => {
    setBusy(true);
    try {
      setOutcome({ text, message: await revealFromText(text, pass) });
    } catch (e) {
      setOutcome({ text, error: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (encrypted) return;
    let current = true;
    revealFromText(text).then(
      (message) => current && setOutcome({ text, message }),
      (e: unknown) => current && setOutcome({ text, error: errorText(e) }),
    );
    return () => {
      current = false;
    };
    // errorText only depends on the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, encrypted]);

  if (shown && 'message' in shown) {
    return (
      <section className="space-y-1 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex flex-1 items-center gap-2 font-medium">
            <EyeIcon className="size-4" aria-hidden="true" />
            {t('workshop.invisible.foundMessage')}
          </h3>
          <CopyButton text={shown.message} label={t('workshop.invisible.copy')} />
        </div>
        <p className="text-sm break-words whitespace-pre-wrap" data-testid="invisible-message">
          {shown.message}
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <p className="text-sm" role="status">
        {t(encrypted ? 'workshop.invisible.lockedFound' : 'workshop.invisible.conbertFound')}
      </p>
      {encrypted && (
        <form
          className="flex max-w-md flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void open(password);
          }}
        >
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="invisible-open-password">{t('workshop.invisible.openPassword')}</Label>
            <Input
              id="invisible-open-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!password || busy}>
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <LockOpenIcon aria-hidden="true" />
            )}
            {t('workshop.invisible.open')}
          </Button>
        </form>
      )}
      {shown && 'error' in shown && (
        <p role="alert" className="text-sm text-destructive">
          {shown.error}
        </p>
      )}
    </section>
  );
}

/** The text with every invisible stretch shown as a small coloured label. */
function Marked({ text, runs }: { text: string; runs: readonly InvisibleRun[] }) {
  const { t } = useTranslation();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const run of runs) {
    if (run.start > at) parts.push(text.slice(at, run.start));
    const codes = [...new Set(run.codes)].map(codePointLabel);
    parts.push(
      <span
        key={run.start}
        className={cn('mx-px rounded px-1 font-mono text-[0.7rem] align-middle', BADGE[run.kind])}
        title={`${t(`workshop.invisible.kinds.${run.kind}.name`)}: ${codes.slice(0, 6).join(', ')}${codes.length > 6 ? ' …' : ''}`}
      >
        {t(`workshop.invisible.kinds.${run.kind}.short`)}
        {run.count > 1 && ` ×${String(run.count)}`}
      </span>,
    );
    at = run.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <p
      className="max-h-64 overflow-auto rounded-lg border p-2 text-sm break-words whitespace-pre-wrap"
      data-testid="invisible-marked"
    >
      {parts}
    </p>
  );
}

function Check() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const runs = useMemo(() => findInvisible(text), [text]);
  const counts = useMemo(() => countInvisible(runs), [runs]);
  const conbert = useMemo(() => peekHiddenText(text), [text]);
  const other = useMemo(() => (conbert ? null : guessBinaryMessage(text)), [text, conbert]);
  const cleaned = useMemo(() => stripInvisible(text, runs), [text, runs]);
  const decoded = runs.filter((r) => r.decoded);
  const total = runs.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="invisible-check">{t('workshop.invisible.input')}</Label>
        <textarea
          id="invisible-check"
          className={TEXTAREA}
          placeholder={t('workshop.invisible.inputPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {text && total === 0 && (
        <p className="rounded-lg border p-3 text-sm" role="status">
          {t('workshop.invisible.clean')}
        </p>
      )}
      {conbert && <ConbertMessage text={text} encrypted={conbert.encrypted} />}
      {other && (
        <section className="space-y-1 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <h3 className="font-medium">{t('workshop.invisible.otherTool')}</h3>
          <p className="text-sm break-words whitespace-pre-wrap">{other}</p>
          <p className="text-xs text-muted-foreground">{t('workshop.invisible.otherToolNote')}</p>
        </section>
      )}
      {decoded.length > 0 && (
        <section className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
          <h3 className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4 text-red-500" aria-hidden="true" />
            {t('workshop.invisible.decodedTitle')}
          </h3>
          {decoded.map((run) => (
            <p
              key={run.start}
              className="rounded border bg-background p-2 font-mono text-sm break-words whitespace-pre-wrap"
            >
              {run.decoded}
            </p>
          ))}
          <p className="text-sm">{t('workshop.invisible.aiWarning')}</p>
        </section>
      )}
      {total > 0 && (
        <>
          <section className="space-y-2">
            <h3 className="font-medium" role="status">
              {t('workshop.invisible.found', { count: total })}
            </h3>
            <ul className="divide-y rounded-lg border text-sm">
              {INVISIBLE_KINDS.filter((k) => counts[k]).map((kind) => (
                <li key={kind} className="flex gap-3 px-3 py-2">
                  <span
                    className={cn(
                      'h-fit shrink-0 rounded px-1.5 font-mono text-xs tabular-nums',
                      BADGE[kind],
                    )}
                  >
                    {counts[kind]}×
                  </span>
                  <span>
                    <span className="font-medium">
                      {t(`workshop.invisible.kinds.${kind}.name`)}
                    </span>
                    {' – '}
                    {t(`workshop.invisible.kinds.${kind}.help`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">{t('workshop.invisible.marked')}</h3>
            <p className="text-xs text-muted-foreground">{t('workshop.invisible.markedHelp')}</p>
            <Marked text={text} runs={runs} />
          </section>
          <section className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 font-medium">{t('workshop.invisible.cleaned')}</h3>
              <CopyButton text={cleaned} label={t('workshop.invisible.copyCleaned')} />
            </div>
            <textarea
              readOnly
              aria-label={t('workshop.invisible.cleaned')}
              className={cn(TEXTAREA, 'min-h-16 bg-muted/30')}
              value={cleaned}
            />
            <p className="text-xs text-muted-foreground">{t('workshop.invisible.cleanedHelp')}</p>
          </section>
        </>
      )}
    </div>
  );
}

/** Invisible text: hide a message with zero-width characters, and find such characters. */
export function InvisibleTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="invisible" />
      <Tabs defaultValue="hide" className="gap-4">
        <TabsList>
          <TabsTrigger value="hide">{t('workshop.invisible.hideTab')}</TabsTrigger>
          <TabsTrigger value="check">{t('workshop.invisible.checkTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="hide" forceMount className="data-[state=inactive]:hidden">
          <Hide />
        </TabsContent>
        <TabsContent value="check" forceMount className="data-[state=inactive]:hidden">
          <Check />
        </TabsContent>
      </Tabs>
    </div>
  );
}
