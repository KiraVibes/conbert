import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon, LockOpenIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vaultWorker } from '@/features/workshop/workshop-worker';
import { useVault } from './vault-api';

/** Opens the vault for this session: the private key is unlocked in the browser. */
export function UnlockForm({ locked, id }: { locked: string; id: string }) {
  const { t } = useTranslation();
  const open = useVault((s) => s.open);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setWrong(false);
        void vaultWorker
          .unlockKey(locked, password)
          .then((r) => {
            if (r.ok) {
              open(r.value);
              setPassword('');
            } else setWrong(true);
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor={id}>{t('vault.password')}</Label>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={password}
          aria-invalid={wrong || undefined}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || password === ''}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <LockOpenIcon aria-hidden="true" />
        )}
        {t('vault.unlock')}
      </Button>
      {wrong && (
        <p role="alert" className="w-full text-sm text-destructive">
          {t('vault.wrongPassword')}
        </p>
      )}
    </form>
  );
}
