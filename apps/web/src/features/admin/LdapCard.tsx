import { useEffect, useState } from 'react';
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  NetworkIcon,
  PlugZapIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { LdapConfig, LdapSettingsDto, LdapTestResponse } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { FormField, PasswordField } from '@/features/auth/FormField';
import { ApiRequestError } from '@/lib/api';
import { LDAP_PRESETS, useLdapGroups, useLdapMutations, useLdapSettings } from './ldap-api';

function apiErrorOf(error: unknown): ApiRequestError | null {
  return error instanceof ApiRequestError ? error : null;
}

type TextField =
  | 'url'
  | 'bindDn'
  | 'userBase'
  | 'userFilter'
  | 'usernameAttr'
  | 'displayNameAttr'
  | 'groupBase'
  | 'groupFilter'
  | 'groupNameAttr';

const MEMBER_ATTRS = ['member', 'uniqueMember', 'memberUid'] as const;

function SwitchRow({
  id,
  checked,
  onChange,
  labelKey,
  helpKey,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  labelKey: string;
  helpKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{t(labelKey)}</Label>
        <HelpTip helpKey={helpKey} labelKey={labelKey} />
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function TestResult({ result }: { result: LdapTestResponse }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
      <p className="flex items-center gap-1.5">
        <CheckCircle2Icon
          className="size-4 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        {t('ldap.test.connected', { users: result.users, groups: result.groups })}
      </p>
      {result.login &&
        (result.login.ok ? (
          <p className="flex items-start gap-1.5">
            <CheckCircle2Icon
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <span>
              {t('ldap.test.loginOk', { name: result.login.displayName ?? result.login.dn ?? '' })}
              {result.login.groups.length > 0 &&
                ` ${t('ldap.test.inGroups', { groups: result.login.groups.join(', ') })}`}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <XCircleIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            {t(`ldap.test.loginFailed.${result.login.reason ?? 'notFound'}`)}
          </p>
        ))}
    </div>
  );
}

/** Pick directory groups and take them over as Conbert groups. */
export function LdapImportDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const groups = useLdapGroups(search, open);
  const { importGroups } = useLdapMutations();
  const error = apiErrorOf(groups.error) ?? apiErrorOf(importGroups.error);

  // Search a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPicked(new Set());
          setQuery('');
          importGroups.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <DownloadIcon aria-hidden="true" />
          {t('ldap.import.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ldap.import.title')}</DialogTitle>
          <DialogDescription>{t('ldap.import.intro')}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ldap.import.search')}
          aria-label={t('ldap.import.search')}
        />
        {groups.isFetching && !groups.data && (
          <Loader2Icon className="mx-auto animate-spin" aria-label={t('ldap.import.loading')} />
        )}
        {groups.data && groups.data.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('ldap.import.none')}</p>
        )}
        {groups.data && groups.data.groups.length > 0 && (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {groups.data.groups.map((g, index) => (
              <li key={g.dn} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <input
                  id={`ldap-group-${index}`}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={g.imported || picked.has(g.dn)}
                  disabled={g.imported}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = new Set(p);
                      if (e.target.checked) next.add(g.dn);
                      else next.delete(g.dn);
                      return next;
                    })
                  }
                />
                <label htmlFor={`ldap-group-${index}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={g.dn}>
                    {g.dn}
                  </span>
                </label>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {g.imported
                    ? t('ldap.import.already')
                    : t('groups.memberCount', { count: g.members })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {groups.data?.truncated && (
          <p className="text-xs text-muted-foreground">{t('ldap.import.truncated')}</p>
        )}
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
        <DialogFooter>
          <Button
            disabled={picked.size === 0 || importGroups.isPending}
            onClick={() =>
              importGroups.mutate([...picked], {
                onSuccess: () => {
                  toast.success(t('ldap.import.done', { count: picked.size }));
                  setOpen(false);
                },
              })
            }
          >
            {t('ldap.import.submit', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LdapForm({ saved }: { saved: LdapSettingsDto }) {
  const { t, i18n } = useTranslation();
  const { save, test, sync } = useLdapMutations();
  const { hasBindPassword, lastSync, ...initial } = saved;
  const [form, setForm] = useState<LdapConfig>(initial);
  // undefined = keep the stored password.
  const [bindPassword, setBindPassword] = useState<string | undefined>(undefined);
  const [testUser, setTestUser] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const set = <K extends keyof LdapConfig>(key: K, value: LdapConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const text = (key: TextField, extra: { hint?: boolean; help?: boolean } = {}) => (
    <FormField
      id={`ldap-${key}`}
      label={t(`ldap.fields.${key}.label`)}
      hint={extra.hint === false ? undefined : t(`ldap.fields.${key}.hint`)}
      helpKey={extra.help ? `ldap.fields.${key}.help` : undefined}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
  const request = {
    ...form,
    ...(bindPassword !== undefined ? { bindPassword } : {}),
  };
  const error = apiErrorOf(save.error) ?? apiErrorOf(test.error) ?? apiErrorOf(sync.error);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(request, {
          onSuccess: () => {
            setBindPassword(undefined);
            toast.success(t('ldap.saved'));
          },
        });
      }}
    >
      <SwitchRow
        id="ldap-enabled"
        checked={form.enabled}
        onChange={(on) => set('enabled', on)}
        labelKey="ldap.fields.enabled.label"
        helpKey="ldap.fields.enabled.help"
      />

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('ldap.presets.label')}</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LDAP_PRESETS) as (keyof typeof LDAP_PRESETS)[]).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setForm((f) => ({ ...f, ...LDAP_PRESETS[p] }))}
            >
              {t(`ldap.presets.${p}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('ldap.presets.hint')}</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{t('ldap.sections.connection')}</legend>
        {text('url', { help: true })}
        <SwitchRow
          id="ldap-starttls"
          checked={form.startTls}
          onChange={(on) => set('startTls', on)}
          labelKey="ldap.fields.startTls.label"
          helpKey="ldap.fields.startTls.help"
        />
        <SwitchRow
          id="ldap-tlsverify"
          checked={form.tlsVerify}
          onChange={(on) => set('tlsVerify', on)}
          labelKey="ldap.fields.tlsVerify.label"
          helpKey="ldap.fields.tlsVerify.help"
        />
        {text('bindDn', { help: true })}
        {hasBindPassword && bindPassword === undefined ? (
          <div className="space-y-1.5">
            <Label>{t('ldap.fields.bindPassword.label')}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t('ldap.fields.bindPassword.stored')}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setBindPassword('')}>
                {t('ldap.fields.bindPassword.change')}
              </Button>
            </div>
          </div>
        ) : (
          <PasswordField
            id="ldap-bindPassword"
            label={t('ldap.fields.bindPassword.label')}
            hint={t('ldap.fields.bindPassword.hint')}
            value={bindPassword ?? ''}
            onChange={(e) => setBindPassword(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{t('ldap.sections.users')}</legend>
        {text('userBase', { help: true })}
        {text('userFilter', { help: true })}
        {text('groupBase', { help: true })}
      </fieldset>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t('ldap.sections.advanced')}
        </summary>
        <div className="mt-3 space-y-3">
          {text('usernameAttr')}
          {text('displayNameAttr')}
          {text('groupFilter', { help: true })}
          {text('groupNameAttr')}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ldap-memberAttr">{t('ldap.fields.memberAttr.label')}</Label>
              <HelpTip
                helpKey="ldap.fields.memberAttr.help"
                labelKey="ldap.fields.memberAttr.label"
              />
            </div>
            <Select value={form.memberAttr} onValueChange={(v) => set('memberAttr', v)}>
              <SelectTrigger id="ldap-memberAttr" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_ATTRS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ldap-caCert">{t('ldap.fields.caCert.label')}</Label>
              <HelpTip helpKey="ldap.fields.caCert.help" labelKey="ldap.fields.caCert.label" />
            </div>
            <textarea
              id="ldap-caCert"
              value={form.caCert}
              onChange={(e) => set('caCert', e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
        </div>
      </details>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{t('ldap.sections.access')}</legend>
        <SwitchRow
          id="ldap-onlyImported"
          checked={form.onlyImportedGroups}
          onChange={(on) => set('onlyImportedGroups', on)}
          labelKey="ldap.fields.onlyImportedGroups.label"
          helpKey="ldap.fields.onlyImportedGroups.help"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ldap-sync">{t('ldap.fields.syncHours.label')}</Label>
            <HelpTip helpKey="ldap.fields.syncHours.help" labelKey="ldap.fields.syncHours.label" />
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="ldap-sync"
              type="number"
              min={0}
              max={168}
              className="w-20"
              value={form.syncHours}
              onChange={(e) =>
                set('syncHours', Math.max(0, Math.min(168, Number(e.target.value) || 0)))
              }
            />
            <span className="text-sm text-muted-foreground">{t('ldap.fields.syncHours.unit')}</span>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">{t('ldap.test.title')}</legend>
        <p className="text-xs text-muted-foreground">{t('ldap.test.intro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="ldap-test-user"
            label={t('ldap.test.username')}
            value={testUser}
            onChange={(e) => setTestUser(e.target.value)}
            autoComplete="off"
          />
          <PasswordField
            id="ldap-test-password"
            label={t('ldap.test.password')}
            value={testPassword}
            onChange={(e) => setTestPassword(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={test.isPending || !form.url}
          onClick={() =>
            test.mutate({
              settings: request,
              ...(testUser ? { username: testUser, password: testPassword } : {}),
            })
          }
        >
          {test.isPending ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <PlugZapIcon aria-hidden="true" />
          )}
          {t('ldap.test.run')}
        </Button>
        {test.data && !test.isPending && <TestResult result={test.data} />}
      </fieldset>

      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('ldap.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={sync.isPending || !saved.enabled}
          onClick={() =>
            sync.mutate(undefined, {
              onSuccess: (r) =>
                toast.success(
                  t('ldap.sync.done', { users: r.status.users, disabled: r.status.disabled }),
                ),
            })
          }
        >
          <RefreshCwIcon
            className={sync.isPending ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          {t('ldap.sync.run')}
        </Button>
      </div>
      {lastSync && (
        <p className="text-xs text-muted-foreground">
          {lastSync.ok
            ? t('ldap.sync.last', {
                when: new Date(lastSync.at).toLocaleString(i18n.language),
                users: lastSync.users,
                groups: lastSync.groups,
              })
            : t('ldap.sync.lastFailed', {
                when: new Date(lastSync.at).toLocaleString(i18n.language),
                reason: t(`${lastSync.errorKey ?? 'errors.ldapUnreachable'}.what`),
              })}
        </p>
      )}
    </form>
  );
}

/** Sign-in with directory accounts (Active Directory, OpenLDAP, lldap …). */
export function LdapCard() {
  const { t } = useTranslation();
  const settings = useLdapSettings();
  const error = apiErrorOf(settings.error);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NetworkIcon className="size-5" aria-hidden="true" />
          {t('ldap.title')}
          <HelpTip helpKey="ldap.help" labelKey="ldap.title" />
        </CardTitle>
        <CardDescription>{t('ldap.intro')}</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending && (
          <Loader2Icon className="animate-spin" aria-label={t('ldap.loading')} />
        )}
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
        {/* key: start with fresh values after every save from elsewhere. */}
        {settings.data && <LdapForm key={JSON.stringify(settings.data)} saved={settings.data} />}
      </CardContent>
    </Card>
  );
}
