import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveBlob } from '@/features/workshop/save-blob';
import { vaultWorker } from '@/features/workshop/workshop-worker';
import { ApiRequestError } from '@/lib/api';
import { UnlockForm } from './UnlockForm';
import {
  KEY_DIRECTORY_KEY,
  MIN_VAULT_PASSWORD,
  MY_KEY_KEY,
  deleteKey,
  saveKey,
  shareKey,
  useMyKey,
  useVault,
} from './vault-api';

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.internal', String(e));

/** New password twice – long enough and the same both times. */
function NewPassword({
  id,
  value,
  onChange,
}: {
  id: string;
  value: { password: string; repeat: string };
  onChange: (v: { password: string; repeat: string }) => void;
}) {
  const { t } = useTranslation();
  const short = value.password !== '' && value.password.length < MIN_VAULT_PASSWORD;
  const differ = value.repeat !== '' && value.repeat !== value.password;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${id}-pw`} className="flex items-center gap-1">
          {t('vault.newPassword')}
          <HelpTip helpKey="vault.passwordHelp" labelKey="vault.newPassword" />
        </Label>
        <Input
          id={`${id}-pw`}
          type="password"
          autoComplete="new-password"
          value={value.password}
          aria-invalid={short || undefined}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
        {short && (
          <p className="text-xs text-destructive">
            {t('vault.tooShort', { count: MIN_VAULT_PASSWORD })}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-repeat`}>{t('vault.repeatPassword')}</Label>
        <Input
          id={`${id}-repeat`}
          type="password"
          autoComplete="new-password"
          value={value.repeat}
          aria-invalid={differ || undefined}
          onChange={(e) => onChange({ ...value, repeat: e.target.value })}
        />
        {differ && <p className="text-xs text-destructive">{t('vault.notSame')}</p>}
      </div>
    </div>
  );
}

const passwordOk = (v: { password: string; repeat: string }) =>
  v.password.length >= MIN_VAULT_PASSWORD && v.password === v.repeat;

/** No key yet: make one, or bring back a backup. */
function CreateKey() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const open = useVault((s) => s.open);
  const [pw, setPw] = useState({ password: '', repeat: '' });
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [restore, setRestore] = useState('');
  const [restorePw, setRestorePw] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { identity, publicKey } = await vaultWorker.newKey();
      const lockedIdentity = await vaultWorker.lockKey(identity, pw.password);
      await saveKey({ publicKey, lockedIdentity });
      open(identity);
      await queryClient.invalidateQueries({ queryKey: MY_KEY_KEY });
      toast.success(t('vault.created'));
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };

  /** A backup (locked, needs its password) or a bare age key (gets the password as new lock). */
  const bringBack = async () => {
    setBusy(true);
    setRestoreError(null);
    try {
      const text = restore.trim();
      let identity: string;
      let lockedIdentity: string;
      if (text.startsWith('-----BEGIN AGE ENCRYPTED FILE-----')) {
        const r = await vaultWorker.unlockKey(text, restorePw);
        if (!r.ok) {
          setRestoreError(t(r.code === 'not-age' ? 'vault.restoreInvalid' : 'vault.wrongPassword'));
          return;
        }
        identity = r.value;
        lockedIdentity = text;
      } else {
        const line = text.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'));
        if (!line) {
          setRestoreError(t('vault.restoreInvalid'));
          return;
        }
        if (restorePw.length < MIN_VAULT_PASSWORD) {
          setRestoreError(t('vault.tooShort', { count: MIN_VAULT_PASSWORD }));
          return;
        }
        identity = line.trim();
        lockedIdentity = await vaultWorker.lockKey(identity, restorePw);
      }
      const publicKey = await vaultWorker.publicKeyOf(identity);
      if (!publicKey) {
        setRestoreError(t('vault.restoreInvalid'));
        return;
      }
      await saveKey({ publicKey, lockedIdentity });
      open(identity);
      setRestore('');
      setRestorePw('');
      await queryClient.invalidateQueries({ queryKey: MY_KEY_KEY });
      toast.success(t('vault.restored'));
    } catch (e) {
      setRestoreError(t(`${asError(e).messageKey}.what`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <NewPassword id="vault-create" value={pw} onChange={setPw} />
        <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-1 font-medium">
              <TriangleAlertIcon className="size-4" aria-hidden="true" />
              {t('vault.warningTitle')}
            </span>
            {t('vault.warning')}
          </span>
        </label>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
        <Button onClick={() => void create()} disabled={busy || !passwordOk(pw) || !understood}>
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <KeyRoundIcon aria-hidden="true" />
          )}
          {t('vault.create')}
        </Button>
      </div>

      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">{t('vault.restoreTitle')}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t('vault.restoreIntro')}</p>
          <Input
            type="file"
            accept=".age,.txt,text/plain"
            aria-label={t('vault.restoreFile')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void file.text().then(setRestore);
            }}
          />
          <textarea
            className="min-h-24 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
            aria-label={t('vault.restoreText')}
            placeholder="-----BEGIN AGE ENCRYPTED FILE----- … / AGE-SECRET-KEY-1…"
            value={restore}
            onChange={(e) => setRestore(e.target.value)}
          />
          <div className="space-y-1">
            <Label htmlFor="vault-restore-pw">{t('vault.password')}</Label>
            <Input
              id="vault-restore-pw"
              type="password"
              autoComplete="current-password"
              value={restorePw}
              onChange={(e) => setRestorePw(e.target.value)}
            />
          </div>
          {restoreError && (
            <p role="alert" className="text-sm text-destructive">
              {restoreError}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => void bringBack()}
            disabled={busy || !restore.trim() || !restorePw}
          >
            {t('vault.restore')}
          </Button>
        </div>
      </details>
    </div>
  );
}

/** "Mein Schlüssel": the account's age key pair. */
export function VaultCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = useMyKey();
  const identity = useVault((s) => s.identity);
  const lock = useVault((s) => s.lock);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState(false);
  const [pw, setPw] = useState({ password: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: MY_KEY_KEY }),
      queryClient.invalidateQueries({ queryKey: KEY_DIRECTORY_KEY }),
    ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <KeyRoundIcon className="size-5" aria-hidden="true" />
          {t('vault.title')}
          <HelpTip helpKey="vault.help" labelKey="vault.title" />
        </CardTitle>
        <CardDescription>{t('vault.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {key.isPending ? (
          <Loader2Icon className="animate-spin text-muted-foreground" aria-hidden="true" />
        ) : !key.data ? (
          <CreateKey />
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('vault.publicKey')}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-xs break-all">
                  {key.data.publicKey}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('vault.copyPublicKey')}
                  onClick={() =>
                    void navigator.clipboard?.writeText(key.data?.publicKey ?? '').then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('vault.publicKeyHelp')}</p>
            </div>

            <div className="flex items-start gap-2">
              <Switch
                id="vault-share"
                checked={key.data.shared}
                onCheckedChange={(shared) => void shareKey(shared).then(refresh)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="vault-share">{t('vault.share')}</Label>
                <p className="text-xs text-muted-foreground">{t('vault.shareHelp')}</p>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              {identity ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-sm">{t('vault.isOpen')}</p>
                  <Button size="sm" variant="outline" onClick={lock}>
                    <LockIcon aria-hidden="true" />
                    {t('vault.lock')}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{t('vault.isLocked')}</p>
                  <UnlockForm locked={key.data.lockedIdentity} id="vault-unlock" />
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  saveBlob(
                    new Blob([key.data?.lockedIdentity ?? ''], { type: 'text/plain' }),
                    'conbert-schluessel.age',
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('vault.backup')}
              </Button>
              <Button variant="outline" disabled={!identity} onClick={() => setChanging((v) => !v)}>
                {t('vault.changePassword')}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost">
                    <Trash2Icon aria-hidden="true" />
                    {t('vault.delete')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('vault.deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('vault.deleteText')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('vault.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void deleteKey()
                          .then(() => lock())
                          .then(refresh)
                      }
                    >
                      {t('vault.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-xs text-muted-foreground">{t('vault.backupHelp')}</p>

            {changing && identity && (
              <div className="space-y-3 rounded-lg border p-3">
                <NewPassword id="vault-change" value={pw} onChange={setPw} />
                <Button
                  disabled={busy || !passwordOk(pw)}
                  onClick={() => {
                    setBusy(true);
                    void vaultWorker
                      .lockKey(identity, pw.password)
                      .then((lockedIdentity) =>
                        saveKey({
                          publicKey: key.data?.publicKey ?? '',
                          lockedIdentity,
                          shared: key.data?.shared ?? false,
                        }),
                      )
                      .then(async () => {
                        await refresh();
                        setChanging(false);
                        setPw({ password: '', repeat: '' });
                        toast.success(t('vault.passwordChanged'));
                      })
                      .catch((e: unknown) => toast.error(t(`${asError(e).messageKey}.what`)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('vault.savePassword')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
