import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LockIcon, Trash2Icon, UnlockIcon } from 'lucide-react';
import {
  BOORU_APIS,
  BOORU_RATINGS,
  SIDECAR_KINDS,
  parseGelbooruCredentials,
  type BooruRating,
} from '@conbert/core';
import type { BooruSettings, BooruSite } from '@conbert/schemas';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiRequestError } from '@/lib/api';
import {
  BOORU_SETTINGS_KEY,
  BOORU_SITES_KEY,
  addInstance,
  deleteAccount,
  lockBooru,
  removeInstance,
  saveAccount,
  saveBooruSettings,
  unlockBooru,
  useBooruSettings,
  useBooruSites,
  type SettingsChange,
} from './booru-api';

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.internal', String(e));

/** Settings → „Booru“: age levels, PIN, blacklist, names, accounts, own instances. */
export function BooruSettingsCard() {
  const { t } = useTranslation();
  const settings = useBooruSettings();
  const sites = useBooruSites();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('booru.settings.title')}</CardTitle>
        <CardDescription>{t('booru.settings.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {settings.data && <RatingsSection settings={settings.data} />}
        {settings.data && <BlacklistSection settings={settings.data} />}
        {settings.data && <DefaultsSection settings={settings.data} />}
        {sites.data && <AccountsSection sites={sites.data} />}
        {sites.data && <InstancesSection sites={sites.data} />}
      </CardContent>
    </Card>
  );
}

function useSave() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [error, setError] = useState<ApiRequestError | null>(null);
  const save = async (change: SettingsChange, success = true) => {
    setError(null);
    try {
      const settings = await saveBooruSettings(change);
      queryClient.setQueryData(BOORU_SETTINGS_KEY, { settings });
      if (success) toast.success(t('booru.settings.saved'));
      return true;
    } catch (e) {
      setError(asError(e));
      return false;
    }
  };
  return { save, error, setError };
}

function RatingsSection({ settings }: { settings: BooruSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { save, error, setError } = useSave();
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const pinPart = settings.locked ? { pin } : {};

  const toggle = (rating: BooruRating) => {
    const next = settings.ratings.includes(rating)
      ? settings.ratings.filter((r) => r !== rating)
      : [...settings.ratings, rating];
    if (next.length > 0) void save({ ratings: next, ...pinPart });
  };
  const lock = async () => {
    setError(null);
    try {
      const next = settings.locked ? (await unlockBooru(pin), null) : await lockBooru(pin);
      if (next) queryClient.setQueryData(BOORU_SETTINGS_KEY, { settings: next });
      else await queryClient.invalidateQueries({ queryKey: BOORU_SETTINGS_KEY });
      setPin('');
      toast.success(t(settings.locked ? 'booru.settings.unlocked' : 'booru.settings.locked'));
    } catch (e) {
      setError(asError(e));
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="booru-ratings">
      <h3 id="booru-ratings" className="flex items-center gap-1.5 font-medium">
        {t('booru.settings.ratings')}
        <HelpTip helpKey="booru.settings.ratingsHelp" labelKey="booru.settings.ratings" />
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {BOORU_RATINGS.map((rating) => {
          const locked = rating !== 'general' && !settings.ageConfirmed;
          return (
            <label
              key={rating}
              className={`flex items-start gap-2 text-sm ${locked ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={settings.ratings.includes(rating)}
                disabled={
                  locked ||
                  (rating === 'general' &&
                    settings.ratings.length === 1 &&
                    settings.ratings[0] === 'general')
                }
                onChange={() => toggle(rating)}
              />
              <span>
                <span className="font-medium">{t(`booru.ratings.${rating}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`booru.ratings.${rating}Help`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {settings.ageConfirmed ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void save({ ageConfirmed: false, ratings: ['general'], ...pinPart })}
        >
          {t('booru.settings.onlyGeneral')}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          {t('booru.settings.unlockAdult')}
        </Button>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="booru-pin" className="flex items-center gap-1.5">
            {t(settings.locked ? 'booru.settings.pinLocked' : 'booru.settings.pin')}
            <HelpTip helpKey="booru.settings.pinHelp" labelKey="booru.settings.pin" />
          </Label>
          <Input
            id="booru-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            className="w-40"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" disabled={pin.length < 4} onClick={() => void lock()}>
          {settings.locked ? <UnlockIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
          {t(settings.locked ? 'booru.settings.unlock' : 'booru.settings.lock')}
        </Button>
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('booru.settings.ageTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('booru.settings.ageText')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('booru.settings.ageNo')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save({ ageConfirmed: true, ...pinPart })}>
              {t('booru.settings.ageYes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function BlacklistSection({ settings }: { settings: BooruSettings }) {
  const { t } = useTranslation();
  const { save, error } = useSave();
  const [text, setText] = useState(settings.blacklist.join('\n'));
  return (
    <section className="space-y-2" aria-labelledby="booru-blacklist">
      <h3 id="booru-blacklist" className="flex items-center gap-1.5 font-medium">
        <label htmlFor="booru-blacklist-text">{t('booru.settings.blacklist')}</label>
        <HelpTip helpKey="booru.settings.blacklistHelp" labelKey="booru.settings.blacklist" />
      </h3>
      <textarea
        id="booru-blacklist-text"
        rows={6}
        spellCheck={false}
        className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => void save({ blacklist: text.split('\n') })}
      >
        {t('booru.settings.save')}
      </Button>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </section>
  );
}

function DefaultsSection({ settings }: { settings: BooruSettings }) {
  const { t } = useTranslation();
  const { save, error } = useSave();
  const [filePattern, setFilePattern] = useState(settings.filePattern);
  const [folderPattern, setFolderPattern] = useState(settings.folderPattern);
  return (
    <section className="space-y-3" aria-labelledby="booru-defaults">
      <h3 id="booru-defaults" className="font-medium">
        {t('booru.settings.defaults')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="booru-default-file" className="flex items-center gap-1.5">
            {t('booru.naming.file')}
            <HelpTip helpKey="booru.naming.help" labelKey="booru.naming.file" />
          </Label>
          <Input
            id="booru-default-file"
            value={filePattern}
            onChange={(e) => setFilePattern(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="booru-default-folder">{t('booru.naming.folder')}</Label>
          <Input
            id="booru-default-folder"
            value={folderPattern}
            onChange={(e) => setFolderPattern(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {SIDECAR_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={settings.sidecars.includes(kind)}
              onChange={() =>
                void save(
                  {
                    sidecars: settings.sidecars.includes(kind)
                      ? settings.sidecars.filter((k) => k !== kind)
                      : [...settings.sidecars, kind],
                  },
                  false,
                )
              }
            />
            {t(`booru.sidecar.${kind}`)}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.sample}
            onChange={(e) => void save({ sample: e.target.checked }, false)}
          />
          {t('booru.download.sample')}
        </label>
      </div>
      <Button size="sm" variant="outline" onClick={() => void save({ filePattern, folderPattern })}>
        {t('booru.settings.save')}
      </Button>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </section>
  );
}

function AccountsSection({ sites }: { sites: BooruSite[] }) {
  const { t } = useTranslation();
  const withAccounts = sites.filter((s) => s.accounts);
  return (
    <section className="space-y-3" aria-labelledby="booru-accounts">
      <h3 id="booru-accounts" className="flex items-center gap-1.5 font-medium">
        {t('booru.settings.accounts')}
        <HelpTip helpKey="booru.settings.accountsHelp" labelKey="booru.settings.accounts" />
      </h3>
      <ul className="space-y-3">
        {withAccounts.map((site) => (
          <li key={site.id}>
            <AccountRow site={site} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccountRow({ site }: { site: BooruSite }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(site.account?.username ?? '');
  const [apiKey, setApiKey] = useState('');
  const [tagLimit, setTagLimit] = useState(
    site.account?.tagLimit ? String(site.account.tagLimit) : '',
  );
  const [error, setError] = useState<ApiRequestError | null>(null);
  const isGelbooru = site.api === 'gelbooru';
  const refresh = () => queryClient.invalidateQueries({ queryKey: BOORU_SITES_KEY });
  const submit = async () => {
    setError(null);
    try {
      await saveAccount(site.id, {
        username: username.trim(),
        apiKey: apiKey.trim(),
        tagLimit: tagLimit.trim() ? Math.max(1, Math.round(Number(tagLimit))) : null,
      });
      setApiKey('');
      setEditing(false);
      await refresh();
      toast.success(t('booru.settings.saved'));
    } catch (e) {
      setError(asError(e));
    }
  };
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{site.name}</span>{' '}
          <span className="text-muted-foreground">
            {site.account
              ? t('booru.settings.accountStored', { username: site.account.username })
              : site.needsAccount
                ? t('booru.settings.accountNeeded')
                : t('booru.settings.noAccount')}
          </span>
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {site.account ? t('booru.settings.change') : t('booru.settings.addAccount')}
          </Button>
          {site.account && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('booru.settings.removeAccount', { site: site.name })}
              onClick={() => void deleteAccount(site.id).then(refresh)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{site.name}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`acc-user-${site.id}`} className="flex items-center gap-1.5">
            {isGelbooru ? t('booru.settings.userId') : t('booru.settings.username')}
            {isGelbooru && (
              <HelpTip helpKey="booru.settings.userIdHelp" labelKey="booru.settings.userId" />
            )}
          </Label>
          <Input
            id={`acc-user-${site.id}`}
            autoComplete="off"
            inputMode={isGelbooru ? 'numeric' : undefined}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`acc-key-${site.id}`}>{t('booru.settings.apiKey')}</Label>
          <Input
            id={`acc-key-${site.id}`}
            type="password"
            autoComplete="off"
            placeholder={site.account ? t('booru.settings.keyStored') : ''}
            value={apiKey}
            onChange={(e) => {
              // The whole Gelbooru access line pasted: split it up.
              const pasted = isGelbooru ? parseGelbooruCredentials(e.target.value) : null;
              if (pasted) setUsername(pasted.userId);
              setApiKey(pasted ? pasted.apiKey : e.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`acc-limit-${site.id}`} className="flex items-center gap-1.5">
            {t('booru.settings.tagLimit')}
            <HelpTip helpKey="booru.settings.tagLimitHelp" labelKey="booru.settings.tagLimit" />
          </Label>
          <Input
            id={`acc-limit-${site.id}`}
            type="number"
            min={1}
            placeholder={String(site.tagLimit)}
            value={tagLimit}
            onChange={(e) => setTagLimit(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {isGelbooru ? t('booru.settings.gelbooruHint') : t('booru.settings.keyHint')}
      </p>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={!username.trim() || (!apiKey.trim() && !site.account)}
        >
          {t('booru.settings.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {t('booru.settings.cancel')}
        </Button>
      </div>
    </div>
  );
}

function InstancesSection({ sites }: { sites: BooruSite[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const own = sites.filter((s) => s.custom);
  const [name, setName] = useState('');
  const [api, setApi] = useState<string>('gelbooru');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<ApiRequestError | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: BOORU_SITES_KEY });
  const add = async () => {
    setError(null);
    try {
      await addInstance({ name: name.trim(), api, baseUrl: baseUrl.trim() });
      setName('');
      setBaseUrl('');
      await refresh();
    } catch (e) {
      setError(asError(e));
    }
  };
  return (
    <section className="space-y-3" aria-labelledby="booru-instances">
      <h3 id="booru-instances" className="flex items-center gap-1.5 font-medium">
        {t('booru.settings.instances')}
        <HelpTip helpKey="booru.settings.instancesHelp" labelKey="booru.settings.instances" />
      </h3>
      {own.length > 0 && (
        <ul className="space-y-1">
          {own.map((site) => (
            <li key={site.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{site.name}</span>{' '}
                <span className="text-muted-foreground">
                  {site.baseUrl} · {t(`booru.api.${site.api}`)}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('booru.settings.removeInstance', { name: site.name })}
                onClick={() => void removeInstance(site.id).then(refresh)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="inst-name">{t('booru.settings.instanceName')}</Label>
          <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inst-api">{t('booru.settings.instanceApi')}</Label>
          <Select value={api} onValueChange={setApi}>
            <SelectTrigger id="inst-api" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOORU_APIS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`booru.api.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inst-url">{t('booru.settings.instanceUrl')}</Label>
          <Input
            id="inst-url"
            type="url"
            placeholder="https://booru.example.org"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <Button onClick={() => void add()} disabled={!name.trim() || !baseUrl.trim()}>
          {t('booru.settings.addInstance')}
        </Button>
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </section>
  );
}
