import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createTokenResponseSchema, tokenListSchema } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
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
import { ApiRequestError, apiDelete, apiGet, apiPost } from '@/lib/api';

const KEY = ['api-tokens'] as const;
const EXPIRY = ['30', '90', '365', 'never'] as const;

function Example({ label, code }: { label: string; code: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">
          <code>{code}</code>
        </pre>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label={t('apiTokens.copy')}
          onClick={() =>
            void navigator.clipboard
              .writeText(code)
              .then(() => toast.success(t('apiTokens.copied')))
          }
        >
          <CopyIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Settings → "API access": tokens for scripts, Home Assistant, n8n and the CLI. */
export function ApiTokensCard() {
  const { t, i18n } = useTranslation();
  const apiGuide = i18n.language.startsWith('de') ? '/docs/api.md' : '/docs/en/api.md';
  const queryClient = useQueryClient();
  const tokens = useQuery({
    queryKey: KEY,
    queryFn: () => apiGet('/api/tokens', tokenListSchema),
  });
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>('90');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const server = window.location.origin;
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' }) : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost(
        '/api/tokens',
        { name: name.trim(), expiresInDays: expiry === 'never' ? null : Number(expiry) },
        createTokenResponseSchema,
      );
      setSecret(created.secret);
      setName('');
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await apiDelete(`/api/tokens/${id}`);
    await queryClient.invalidateQueries({ queryKey: KEY });
    toast.success(t('apiTokens.revoked'));
  };

  const shown = secret ?? '<TOKEN>';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t('apiTokens.title')}
          <HelpTip helpKey="apiTokens.help" labelKey="apiTokens.title" />
        </CardTitle>
        <CardDescription>{t('apiTokens.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="token-name">{t('apiTokens.name')}</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={60}
              placeholder={t('apiTokens.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="token-expiry">{t('apiTokens.expiry')}</Label>
            <Select value={expiry} onValueChange={(v) => setExpiry(v as (typeof EXPIRY)[number])}>
              <SelectTrigger id="token-expiry" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t(`apiTokens.expiries.${e}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void create()} disabled={busy || name.trim() === ''}>
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <PlusIcon aria-hidden="true" />
            )}
            {t('apiTokens.create')}
          </Button>
        </div>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

        {secret && (
          <div
            className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
            role="status"
            data-testid="token-secret"
          >
            <p className="text-sm font-medium">{t('apiTokens.onlyOnce')}</p>
            <Example label={t('apiTokens.yourToken')} code={secret} />
          </div>
        )}

        {tokens.data && tokens.data.tokens.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {tokens.data.tokens.map((token) => (
              <li key={token.id} className="flex items-center gap-3 p-3" data-testid="api-token">
                <KeyRoundIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{token.prefix}</code> ·{' '}
                    {t('apiTokens.created', { date: date(token.createdAt) })} ·{' '}
                    {token.lastUsedAt
                      ? t('apiTokens.lastUsed', { date: date(token.lastUsedAt) })
                      : t('apiTokens.neverUsed')}{' '}
                    ·{' '}
                    {token.expiresAt
                      ? t('apiTokens.expires', { date: date(token.expiresAt) })
                      : t('apiTokens.noExpiry')}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void revoke(token.id)}
                  aria-label={t('apiTokens.revokeNamed', { name: token.name })}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t('apiTokens.howTo')}</summary>
          <div className="mt-3 space-y-3">
            <Example
              label={t('apiTokens.exampleCurl')}
              code={`curl -H "Authorization: Bearer ${shown}" --data-binary @foto.heic "${server}/api/convert?to=jpg&name=foto.heic" -o foto.jpg`}
            />
            <Example
              label={t('apiTokens.exampleCli')}
              code={`curl -O ${server}/cli/conbert.mjs\nnode conbert.mjs login ${server} ${shown}\nnode conbert.mjs convert foto.heic --to jpg`}
            />
            <p className="text-sm">
              {t('apiTokens.guide')}{' '}
              <a className="underline" href={apiGuide} target="_blank" rel="noreferrer">
                {apiGuide}
              </a>
            </p>
            <p className="text-sm text-muted-foreground">
              {t('apiTokens.openapi')}{' '}
              <a className="underline" href="/api/openapi.json" target="_blank" rel="noreferrer">
                /api/openapi.json
              </a>
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
