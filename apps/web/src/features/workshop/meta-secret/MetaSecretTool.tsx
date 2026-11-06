import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeOffIcon, Loader2Icon, LockIcon, SparklesIcon } from 'lucide-react';
import {
  META_SECRET_EXTS,
  messageFields,
  metaSpotFor,
  openMessage,
  sealMessage,
  StegoError,
  type MessageField,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { readMetadata } from '@/features/metadata/metadata-engine';
import { extOf } from '../audio-convert';
import { CopyButton } from '../CopyButton';
import { saveBlob } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';
import { OpenWithPassword } from '../stego/parts';
import { SecretWriteError, writeSecret } from './write-secret';

const TEXTAREA = 'min-h-24 w-full rounded-md border bg-transparent p-2 text-sm';

function Hide() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const ext = file ? extOf(file.name) : '';
  const spot = file ? metaSpotFor(ext) : null;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await sealMessage(message, password);
      setResult({ blob: await writeSecret(file, ext, value), name: file.name });
    } catch (e) {
      console.error('Writing the secret message failed', e);
      const code = e instanceof SecretWriteError ? e.code : 'failed';
      setError(t(`workshop.metasecret.errors.${code}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t('workshop.metasecret.file')}</Label>
        <SingleFile
          file={file}
          onFile={(f) => {
            setFile(f);
            setResult(null);
            setError(null);
          }}
        />
        {file && spot && (
          <p className="text-sm text-muted-foreground">{t(`workshop.metasecret.spots.${spot}`)}</p>
        )}
        {file && !spot && (
          <p role="alert" className="text-sm text-destructive">
            {t('workshop.metasecret.errors.unsupported', { formats: META_SECRET_EXTS.join(', ') })}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="metasecret-message">{t('workshop.metasecret.message')}</Label>
        <textarea
          id="metasecret-message"
          className={TEXTAREA}
          placeholder={t('workshop.metasecret.messagePlaceholder')}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setResult(null);
          }}
        />
      </div>
      <div className="max-w-sm space-y-1">
        <Label htmlFor="metasecret-password" className="flex items-center gap-1">
          {t('workshop.metasecret.password')}
          <HelpTip
            helpKey="workshop.metasecret.passwordHelp"
            labelKey="workshop.metasecret.password"
          />
        </Label>
        <Input
          id="metasecret-password"
          type="password"
          autoComplete="new-password"
          placeholder={t('workshop.stego.passwordPlaceholder')}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setResult(null);
          }}
        />
      </div>
      <Button onClick={() => void run()} disabled={!spot || !message.trim() || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <EyeOffIcon aria-hidden="true" />
        )}
        {t(busy ? 'workshop.metasecret.hiding' : 'workshop.metasecret.hide')}
      </Button>
      {busy && spot && spot !== 'pdf' && (
        <p className="text-xs text-muted-foreground">{t('workshop.metasecret.firstTime')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <section className="space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
          <p className="flex items-center gap-2 font-medium" role="status">
            <SparklesIcon className="size-4 text-emerald-600" aria-hidden="true" />
            {t('workshop.metasecret.done')}
          </p>
          <Button onClick={() => saveBlob(result.blob, result.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.stego.save', { name: result.name })}
          </Button>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {t(password ? 'workshop.metasecret.keepSafeLocked' : 'workshop.metasecret.keepSafe')}
          </p>
        </section>
      )}
    </div>
  );
}

/** A locked Conbert message: password, then the text. */
function SealedField({ field }: { field: MessageField }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      setOpened(await openMessage(field.value, password));
    } catch (e) {
      const code = e instanceof StegoError ? e.code : 'damaged';
      setError(t(`workshop.metasecret.errors.${code === 'wrong-password' ? code : 'damaged'}`));
    } finally {
      setBusy(false);
    }
  };

  if (opened !== null) {
    return (
      <section className="space-y-1 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 font-medium">{t('workshop.metasecret.opened')}</h3>
          <CopyButton text={opened} label={t('workshop.stego.copy')} />
        </div>
        <p className="text-sm break-words whitespace-pre-wrap" data-testid="metasecret-opened">
          {opened}
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <p className="flex items-center gap-2 text-sm" role="status">
        <LockIcon className="size-4" aria-hidden="true" />
        {t('workshop.metasecret.sealedIn', { field: field.key })}
      </p>
      <OpenWithPassword medium="picture" intro={false} busy={busy} onOpen={(p) => void open(p)} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function Reveal() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{ file: File; fields: MessageField[] | 'failed' } | null>(
    null,
  );
  const shown = state?.file === file ? state.fields : null;

  useEffect(() => {
    if (!file) return;
    let current = true;
    readMetadata(file, extOf(file.name)).then(
      (tags) => current && setState({ file, fields: messageFields(tags) }),
      (e: unknown) => {
        console.error('Reading metadata failed', e);
        if (current) setState({ file, fields: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [file]);

  const sealed = Array.isArray(shown) ? shown.filter((f) => f.sealed) : [];
  const plain = Array.isArray(shown) ? shown.filter((f) => !f.sealed) : [];

  return (
    <div className="space-y-4">
      <SingleFile file={file} onFile={setFile} />
      {file && !shown && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('workshop.metasecret.reading')}
        </p>
      )}
      {shown === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.metasecret.errors.readFailed')}
        </p>
      )}
      {Array.isArray(shown) && shown.length === 0 && (
        <p className="rounded-lg border p-3 text-sm" role="status">
          {t('workshop.metasecret.noneFound')}
        </p>
      )}
      {sealed.map((field) => (
        <SealedField key={`${file?.name ?? ''}-${field.key}`} field={field} />
      ))}
      {plain.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('workshop.metasecret.fieldsTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('workshop.metasecret.fieldsIntro')}</p>
          <dl className="divide-y rounded-lg border text-sm" data-testid="metasecret-fields">
            {plain.map((field) => (
              <div key={field.key} className="flex gap-3 px-3 py-2">
                <dt className="w-44 shrink-0 font-mono text-xs break-all text-muted-foreground">
                  {field.key}
                </dt>
                <dd className="min-w-0 flex-1 break-words whitespace-pre-wrap">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

/** Secret message in metadata: write a text into a comment field, and read such fields. */
export function MetaSecretTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="metasecret" />
      <Tabs defaultValue="hide" className="gap-4">
        <TabsList>
          <TabsTrigger value="hide">{t('workshop.stego.hideTab')}</TabsTrigger>
          <TabsTrigger value="reveal">{t('workshop.stego.revealTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="hide" forceMount className="data-[state=inactive]:hidden">
          <Hide />
        </TabsContent>
        <TabsContent value="reveal" forceMount className="data-[state=inactive]:hidden">
          <Reveal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
