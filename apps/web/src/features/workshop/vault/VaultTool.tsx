import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2Icon, LockIcon, LockOpenIcon, XIcon } from 'lucide-react';
import { decryptedName, encryptedName, parseRecipients } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dropzone } from '@/features/convert/Dropzone';
import { ContactBook, ContactChecklist, SaveAsContact } from '@/features/vault/ContactBook';
import { UnlockForm } from '@/features/vault/UnlockForm';
import {
  shortKey,
  useContacts,
  useKeyDirectory,
  useMyKey,
  useVault,
} from '@/features/vault/vault-api';
import { formatBytes } from '@/lib/format-bytes';
import { useView } from '@/lib/use-view';
import { saveBlob } from '../save-blob';
import { vaultWorker } from '../workshop-worker';

type Way = 'keys' | 'password';

function FileList({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const { t, i18n } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(f.size, i18n.language)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('vault.tool.remove', { name: f.name })}
            onClick={() => onRemove(i)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function WayChoice({ value, onChange }: { value: Way; onChange: (w: Way) => void }) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as Way)}
      aria-label={t('vault.tool.way')}
    >
      <ToggleGroupItem value="keys">{t('vault.tool.wayKeys')}</ToggleGroupItem>
      <ToggleGroupItem value="password">{t('vault.tool.wayPassword')}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function EncryptPanel() {
  const { t } = useTranslation();
  const [, navigate] = useView();
  const myKey = useMyKey().data;
  const directory = useKeyDirectory().data ?? [];
  const contacts = useContacts().data ?? [];
  const [chosen, setChosen] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [way, setWay] = useState<Way>('keys');
  const [forMe, setForMe] = useState(true);
  const [people, setPeople] = useState<string[]>([]);
  const [pasted, setPasted] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const extra = parseRecipients(pasted);
  const recipients = [
    ...(forMe && myKey ? [myKey.publicKey] : []),
    ...contacts.filter((c) => chosen.includes(c.id)).map((c) => c.publicKey),
    ...directory.filter((k) => people.includes(k.userId)).map((k) => k.publicKey),
    ...extra.valid,
  ];
  const known = new Map(contacts.map((c) => [c.publicKey, c.name]));
  const unknownPasted = extra.valid.filter((k) => !known.has(k));
  const knownPasted = extra.valid.filter((k) => known.has(k));
  const ready =
    files.length > 0 && (way === 'keys' ? recipients.length > 0 : passphrase.length >= 10);

  const run = async () => {
    setBusy(true);
    try {
      for (const file of files) {
        const out = await vaultWorker.encryptFile(
          file,
          way === 'keys' ? { recipients } : { passphrase },
        );
        saveBlob(out, encryptedName(file.name));
      }
      toast.success(t('vault.tool.encrypted', { count: files.length }));
      setFiles([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Dropzone compact onFiles={(added) => setFiles((f) => [...f, ...added])} />
      <FileList files={files} onRemove={(i) => setFiles((f) => f.filter((_, k) => k !== i))} />
      <WayChoice value={way} onChange={setWay} />
      {way === 'keys' ? (
        <fieldset className="space-y-3">
          <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
            {t('vault.tool.for')}
            <HelpTip helpKey="vault.tool.forHelp" labelKey="vault.tool.for" />
          </legend>
          {myKey ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={forMe} onChange={(e) => setForMe(e.target.checked)} />
              {t('vault.tool.forMe')}
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('vault.tool.noOwnKey')}{' '}
              <Button variant="link" className="h-auto p-0" onClick={() => navigate('settings')}>
                {t('vault.tool.toSettings')}
              </Button>
            </p>
          )}
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-sm font-medium">
              {t('vault.contacts.pick')}
              <HelpTip helpKey="vault.contacts.help" labelKey="vault.contacts.title" />
            </p>
            <ContactChecklist contacts={contacts} selected={chosen} onChange={setChosen} />
          </div>
          {directory.length > 0 && (
            <p className="text-sm font-medium">{t('vault.contacts.users')}</p>
          )}
          {directory.map((k) => (
            <label key={k.userId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={people.includes(k.userId)}
                onChange={(e) =>
                  setPeople((p) =>
                    e.target.checked ? [...p, k.userId] : p.filter((x) => x !== k.userId),
                  )
                }
              />
              {k.displayName ? `${k.displayName} (${k.username})` : k.username}
            </label>
          ))}
          <div className="space-y-1">
            <Label htmlFor="vault-recipients">{t('vault.tool.pasteKeys')}</Label>
            <textarea
              id="vault-recipients"
              className="min-h-16 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
              placeholder="age1…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            {extra.invalid.length > 0 && (
              <p className="text-xs text-destructive">
                {t('vault.tool.invalidKeys', { keys: extra.invalid.slice(0, 3).join(', ') })}
              </p>
            )}
            {knownPasted.map((k) => (
              <p key={k} className="text-xs text-muted-foreground">
                <code>{shortKey(k)}</code>: {t('vault.contacts.knownAs', { name: known.get(k) })}
              </p>
            ))}
            {unknownPasted.length > 0 && (
              <ul className="space-y-2 pt-1">
                {unknownPasted.map((k) => (
                  <SaveAsContact key={k} publicKey={k} />
                ))}
              </ul>
            )}
          </div>
        </fieldset>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="vault-passphrase" className="flex items-center gap-1">
            {t('vault.tool.passphrase')}
            <HelpTip helpKey="vault.tool.passphraseHelp" labelKey="vault.tool.passphrase" />
          </Label>
          <Input
            id="vault-passphrase"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          {passphrase !== '' && passphrase.length < 10 && (
            <p className="text-xs text-destructive">{t('vault.tooShort', { count: 10 })}</p>
          )}
        </div>
      )}
      <Button onClick={() => void run()} disabled={busy || !ready}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <LockIcon aria-hidden="true" />
        )}
        {t('vault.tool.encrypt', { count: files.length })}
      </Button>
    </div>
  );
}

function DecryptPanel() {
  const { t } = useTranslation();
  const myKey = useMyKey().data;
  const identity = useVault((s) => s.identity);
  const [files, setFiles] = useState<File[]>([]);
  const [way, setWay] = useState<Way>('keys');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = files.length > 0 && (way === 'keys' ? identity !== null : passphrase !== '');

  const run = async () => {
    setBusy(true);
    try {
      let done = 0;
      for (const file of files) {
        const r = await vaultWorker.decryptFile(
          file,
          way === 'keys' && identity ? { identity } : { passphrase },
        );
        if (r.ok) {
          saveBlob(r.value, decryptedName(file.name, t('vault.tool.decryptedSuffix')));
          done++;
        } else {
          toast.error(t(`vault.tool.errors.${r.code}`, { name: file.name }));
        }
      }
      if (done > 0) toast.success(t('vault.tool.decrypted', { count: done }));
      setFiles([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Dropzone compact onFiles={(added) => setFiles((f) => [...f, ...added])} />
      <FileList files={files} onRemove={(i) => setFiles((f) => f.filter((_, k) => k !== i))} />
      <WayChoice value={way} onChange={setWay} />
      {way === 'keys' ? (
        identity ? (
          <p className="text-sm text-muted-foreground">{t('vault.isOpen')}</p>
        ) : myKey ? (
          <UnlockForm locked={myKey.lockedIdentity} id="vault-tool-unlock" />
        ) : (
          <p className="text-sm text-muted-foreground">{t('vault.tool.noOwnKey')}</p>
        )
      ) : (
        <div className="space-y-1">
          <Label htmlFor="vault-open-passphrase">{t('vault.tool.passphrase')}</Label>
          <Input
            id="vault-open-passphrase"
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
      )}
      <Button onClick={() => void run()} disabled={busy || !ready}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <LockOpenIcon aria-hidden="true" />
        )}
        {t('vault.tool.decrypt', { count: files.length })}
      </Button>
    </div>
  );
}

/** "Verschlüsseln für …": age files for yourself, other users, anyone with a key – or a password. */
export function VaultTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">{t('workshop.howItWorks')}</summary>
        <p className="mt-2 leading-relaxed">{t('workshop.tricks.vault.how')}</p>
      </details>
      <Tabs defaultValue="encrypt" className="gap-4">
        <TabsList>
          <TabsTrigger value="encrypt">{t('vault.tool.encryptTab')}</TabsTrigger>
          <TabsTrigger value="decrypt">{t('vault.tool.decryptTab')}</TabsTrigger>
          <TabsTrigger value="contacts">{t('vault.contacts.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="encrypt">
          <EncryptPanel />
        </TabsContent>
        <TabsContent value="decrypt">
          <DecryptPanel />
        </TabsContent>
        <TabsContent value="contacts" className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('vault.contacts.intro')}</p>
          <ContactBook />
        </TabsContent>
      </Tabs>
    </div>
  );
}
