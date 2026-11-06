import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { NOTIFICATION_EVENTS, NOTIFICATION_TYPES, type ChannelDto } from '@conbert/schemas';
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
import { ApiRequestError } from '@/lib/api';
import {
  CHANNELS_KEY,
  createChannel,
  deleteChannel,
  testChannel,
  useChannels,
} from './workflows-api';

type ChannelType = ChannelDto['type'];
type Event = (typeof NOTIFICATION_EVENTS)[number];

/** Fields per type; `secret` ones are stored encrypted and never shown again. */
const FIELDS: Record<
  ChannelType,
  { key: string; secret?: boolean; placeholder?: string; type?: string }[]
> = {
  browser: [],
  ntfy: [
    { key: 'server', placeholder: 'https://ntfy.sh' },
    { key: 'topic' },
    { key: 'token', secret: true },
  ],
  gotify: [
    { key: 'server', placeholder: 'https://gotify.example.org' },
    { key: 'token', secret: true },
  ],
  discord: [{ key: 'webhookUrl', secret: true, placeholder: 'https://discord.com/api/webhooks/…' }],
  telegram: [{ key: 'botToken', secret: true }, { key: 'chatId' }],
  email: [
    { key: 'host', placeholder: 'smtp.example.org' },
    { key: 'port', placeholder: '587', type: 'number' },
    { key: 'user' },
    { key: 'password', secret: true, type: 'password' },
    { key: 'from', placeholder: 'conbert@example.org' },
    { key: 'to', placeholder: 'ich@example.org' },
  ],
};

const asError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.internal', String(e));

/** Settings → „Benachrichtigungen“. */
export function NotificationsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const channels = useChannels();
  const [type, setType] = useState<ChannelType>('browser');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [security, setSecurity] = useState('starttls');
  const [events, setEvents] = useState<Event[]>(['batch-done', 'subscription-new', 'error']);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });

  const add = async () => {
    setError(null);
    const settings: Record<string, string> = type === 'email' ? { security } : {};
    const secrets: Record<string, string> = {};
    for (const field of FIELDS[type]) {
      const value = values[field.key]?.trim();
      if (!value) continue;
      (field.secret ? secrets : settings)[field.key] = value;
    }
    try {
      await createChannel({
        name: name.trim() || t(`notifications.types.${type}`),
        type,
        settings,
        secrets,
        events,
      });
      if (
        type === 'browser' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        await Notification.requestPermission();
      }
      setValues({});
      setName('');
      await refresh();
      toast.success(t('notifications.added'));
    } catch (e) {
      setError(asError(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BellIcon className="size-4" aria-hidden="true" />
          {t('notifications.title')}
        </CardTitle>
        <CardDescription>{t('notifications.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {(channels.data?.length ?? 0) > 0 && (
          <ul className="space-y-2">
            {channels.data?.map((channel) => (
              <li key={channel.id}>
                <ChannelRow channel={channel} onChange={() => void refresh()} />
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 rounded-lg border p-3">
          <p className="font-medium">{t('notifications.add')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="channel-type" className="flex items-center gap-1.5">
                {t('notifications.type')}
                <HelpTip
                  helpKey={`notifications.help.${type}`}
                  labelKey={`notifications.types.${type}`}
                />
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as ChannelType)}>
                <SelectTrigger id="channel-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTIFICATION_TYPES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`notifications.types.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">{t('notifications.name')}</Label>
              <Input
                id="channel-name"
                value={name}
                placeholder={t(`notifications.types.${type}`)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {FIELDS[type].map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`channel-${field.key}`}>
                  {t(`notifications.fields.${field.key}`)}
                </Label>
                <Input
                  id={`channel-${field.key}`}
                  type={field.secret ? 'password' : (field.type ?? 'text')}
                  autoComplete="off"
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              </div>
            ))}
            {type === 'email' && (
              <div className="space-y-1.5">
                <Label htmlFor="channel-security">{t('notifications.fields.security')}</Label>
                <Select value={security} onValueChange={setSecurity}>
                  <SelectTrigger id="channel-security" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['starttls', 'tls', 'none'].map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(`notifications.security.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t(`notifications.help.${type}`)}</p>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('notifications.events')}</legend>
            <div className="flex flex-wrap gap-3">
              {NOTIFICATION_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={events.includes(event)}
                    onChange={() =>
                      setEvents((list) =>
                        list.includes(event) ? list.filter((x) => x !== event) : [...list, event],
                      )
                    }
                  />
                  {t(`notifications.event.${event}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <Button size="sm" onClick={() => void add()} disabled={events.length === 0}>
            {t('notifications.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelRow({ channel, onChange }: { channel: ChannelDto; onChange: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<ApiRequestError | null>(null);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{channel.name}</span>{' '}
          <span className="text-muted-foreground">
            {t(`notifications.types.${channel.type}`)} ·{' '}
            {channel.events.map((e) => t(`notifications.event.${e}`)).join(', ')}
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setError(null);
            void testChannel(channel.id)
              .then(() => toast.success(t('notifications.testSent')))
              .catch((e: unknown) => setError(asError(e)));
          }}
        >
          <SendIcon aria-hidden="true" />
          {t('notifications.test')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('notifications.remove', { name: channel.name })}
          onClick={() => void deleteChannel(channel.id).then(onChange)}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </div>
  );
}
