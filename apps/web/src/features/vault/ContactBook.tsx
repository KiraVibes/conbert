import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  BookUserIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react';
import { isAgeRecipient } from '@conbert/core';
import type { Contact } from '@conbert/schemas';
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
import { ApiRequestError } from '@/lib/api';
import {
  CONTACTS_KEY,
  createContact,
  deleteContact,
  isSecretKey,
  shortKey,
  updateContact,
  useContacts,
  useMyKey,
} from './vault-api';

const asApiError = (e: unknown) =>
  e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network');

/** Above this many contacts the lists get a search field. */
const SEARCH_FROM = 6;

const matches = (c: Contact, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    q === '' ||
    c.name.toLowerCase().includes(q) ||
    (c.note ?? '').toLowerCase().includes(q) ||
    c.publicKey.toLowerCase().startsWith(q)
  );
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          toast.success(t('vault.contacts.copied'));
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </Button>
  );
}

/** Text under a key field: not a key, or – worse – a private key. */
function KeyProblem({ value }: { value: string }) {
  const { t } = useTranslation();
  if (value.trim() === '' || isAgeRecipient(value)) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {isSecretKey(value) ? t('vault.contacts.secretKey') : t('vault.contacts.invalidKey')}
    </p>
  );
}

function AddContactForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const ready = name.trim() !== '' && isAgeRecipient(key);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const contact = await createContact({
        name: name.trim(),
        publicKey: key.trim(),
        ...(note.trim() && { note: note.trim() }),
      });
      await queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      toast.success(t('vault.contacts.added', { name: contact.name }));
      setName('');
      setKey('');
      setNote('');
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void save();
      }}
    >
      <p className="text-sm font-medium">{t('vault.contacts.new')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="contact-name">{t('vault.contacts.name')}</Label>
          <Input
            id="contact-name"
            value={name}
            maxLength={80}
            placeholder={t('vault.contacts.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-note">{t('vault.contacts.note')}</Label>
          <Input
            id="contact-note"
            value={note}
            maxLength={500}
            placeholder={t('vault.contacts.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="contact-key" className="flex items-center gap-1">
          {t('vault.contacts.key')}
          <HelpTip helpKey="vault.contacts.keyHelp" labelKey="vault.contacts.key" />
        </Label>
        <Input
          id="contact-key"
          className="font-mono text-xs"
          value={key}
          autoComplete="off"
          spellCheck={false}
          placeholder="age1…"
          onChange={(e) => setKey(e.target.value)}
        />
        <KeyProblem value={key} />
      </div>
      <Button type="submit" disabled={busy || !ready}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <PlusIcon aria-hidden="true" />
        )}
        {t('vault.contacts.add')}
      </Button>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </form>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name);
  const [note, setNote] = useState(contact.note ?? '');
  const [error, setError] = useState<ApiRequestError | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });

  const save = async () => {
    setError(null);
    try {
      await updateContact(contact.id, { name: name.trim(), note: note.trim() || null });
      await refresh();
      setEditing(false);
      toast.success(t('vault.contacts.saved'));
    } catch (e) {
      setError(asApiError(e));
    }
  };

  const remove = async () => {
    try {
      await deleteContact(contact.id);
      await refresh();
      toast.success(t('vault.contacts.deleted', { name: contact.name }));
    } catch (e) {
      setError(asApiError(e));
    }
  };

  return (
    <li className="space-y-2 p-3" data-testid="contact">
      {editing ? (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <Input
            aria-label={t('vault.contacts.name')}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label={t('vault.contacts.note')}
            value={note}
            maxLength={500}
            placeholder={t('vault.contacts.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-1">
            <Button type="submit" size="sm" disabled={name.trim() === ''}>
              {t('vault.contacts.save')}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('vault.contacts.cancel')}
              onClick={() => {
                setEditing(false);
                setName(contact.name);
                setNote(contact.note ?? '');
              }}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium">{contact.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              <code title={contact.publicKey}>{shortKey(contact.publicKey)}</code>
              {contact.note && <> · {contact.note}</>}
            </p>
          </div>
          <CopyButton
            text={contact.publicKey}
            label={t('vault.contacts.copy', { name: contact.name })}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('vault.contacts.edit', { name: contact.name })}
            onClick={() => setEditing(true)}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('vault.contacts.delete', { name: contact.name })}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('vault.contacts.deleteTitle', { name: contact.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('vault.contacts.deleteText')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('vault.contacts.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void remove()}>
                  {t('vault.contacts.deleteConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </li>
  );
}

/** Manage the contact book: add, rename, note, copy, delete – and hand out your own key. */
export function ContactBook() {
  const { t } = useTranslation();
  const contacts = useContacts();
  const myKey = useMyKey().data;
  const [query, setQuery] = useState('');
  const list = contacts.data ?? [];
  const shown = list.filter((c) => matches(c, query));

  return (
    <div className="space-y-4">
      {myKey && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-medium">
              {t('vault.contacts.myKey')}
              <HelpTip helpKey="vault.contacts.myKeyHelp" labelKey="vault.contacts.myKey" />
            </p>
            <code className="block truncate text-xs text-muted-foreground">{myKey.publicKey}</code>
          </div>
          <CopyButton text={myKey.publicKey} label={t('vault.contacts.copyMine')} />
        </div>
      )}
      <AddContactForm />
      {list.length >= SEARCH_FROM && (
        <Input
          type="search"
          aria-label={t('vault.contacts.search')}
          placeholder={t('vault.contacts.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {contacts.isPending ? (
        <Loader2Icon className="animate-spin text-muted-foreground" aria-hidden="true" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('vault.contacts.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('vault.contacts.noMatch', { query })}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings → "Kontaktbuch". */
export function ContactsCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BookUserIcon className="size-5" aria-hidden="true" />
          {t('vault.contacts.title')}
          <HelpTip helpKey="vault.contacts.help" labelKey="vault.contacts.title" />
        </CardTitle>
        <CardDescription>{t('vault.contacts.intro')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ContactBook />
      </CardContent>
    </Card>
  );
}

/** Tick people from the contact book (encrypt panel and workflow step). */
export function ContactChecklist({
  contacts,
  selected,
  onChange,
}: {
  contacts: Contact[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  if (contacts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('vault.contacts.pickEmpty')}</p>;
  }
  // Ticked contacts stay visible while searching.
  const shown = contacts.filter((c) => selected.includes(c.id) || matches(c, query));
  return (
    <div className="space-y-2">
      {contacts.length >= SEARCH_FROM && (
        <Input
          type="search"
          className="h-8"
          aria-label={t('vault.contacts.search')}
          placeholder={t('vault.contacts.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id),
                  )
                }
              />
              <span className="min-w-0 truncate">
                {c.name}
                {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pasted keys that aren't in the contact book yet: offer to keep each one
 * under a name, so it can be ticked next time.
 */
export function SaveAsContact({ publicKey }: { publicKey: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const contact = await createContact({ name: name.trim(), publicKey });
      await queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
      toast.success(t('vault.contacts.added', { name: contact.name }));
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-muted-foreground" title={publicKey}>
          {shortKey(publicKey)}
        </code>
        {!open && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>
            <UserPlusIcon aria-hidden="true" />
            {t('vault.contacts.saveAsContact')}
          </Button>
        )}
      </div>
      {open && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <Input
            className="h-8"
            autoFocus
            aria-label={t('vault.contacts.nameFor', { key: shortKey(publicKey) })}
            placeholder={t('vault.contacts.namePlaceholder')}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="sm" className="h-8" disabled={busy || name.trim() === ''}>
            {t('vault.contacts.save')}
          </Button>
        </form>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </li>
  );
}
