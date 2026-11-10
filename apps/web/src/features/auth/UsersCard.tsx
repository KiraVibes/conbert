import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyRoundIcon,
  LockKeyholeOpenIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  FEATURES,
  PASSWORD_MIN_LENGTH,
  type Feature,
  type PermissionOverrides,
  userResponseSchema,
  type CreateUserRequest,
  type Role,
  type UpdateUserRequest,
  type UserDto,
} from '@conbert/schemas';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ApiRequestError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { FormField, PasswordField } from './FormField';
import { useCurrentUser } from './use-auth';
import { USERS_KEY, useUsers } from './users-api';
import { Badge } from '@/components/ui/badge';
import { GROUPS_KEY, useGroups } from '@/features/admin/groups-api';

function apiErrorOf(error: unknown): ApiRequestError | null {
  return error instanceof ApiRequestError ? error : null;
}

function useUserMutations() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: USERS_KEY });
    // Group lists show their members, so they change along.
    await queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateUserRequest) => apiPost('/api/users', body, userResponseSchema),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
        apiPatch(`/api/users/${id}`, body, userResponseSchema),
      onSuccess: refresh,
    }),
    resetPin: useMutation({
      mutationFn: (id: string) => apiDelete(`/api/users/${id}/booru-pin`),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiDelete(`/api/users/${id}`),
      onSuccess: refresh,
    }),
  };
}

function CreateUserDialog() {
  const { t } = useTranslation();
  const { create, update } = useUserMutations();
  const ownGroups = (useGroups().data ?? []).filter((g) => g.builtin === null);
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const valid = username.trim().length >= 2 && password.length >= PASSWORD_MIN_LENGTH;
  const error = apiErrorOf(create.error) ?? apiErrorOf(update.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUsername('');
          setPassword('');
          setRole('user');
          setGroupIds(new Set());
          create.reset();
          update.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlusIcon aria-hidden="true" />
          {t('auth.users.add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            create.mutate(
              { username, password, role },
              {
                onSuccess: async ({ user }) => {
                  try {
                    if (groupIds.size > 0) {
                      await update.mutateAsync({ id: user.id, body: { groupIds: [...groupIds] } });
                    }
                    toast.success(t('auth.users.created', { name: username }));
                    setOpen(false);
                  } catch {
                    // The account exists; the error shows in the dialog.
                  }
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('auth.users.addTitle')}</DialogTitle>
            <DialogDescription>{t('auth.users.addIntro')}</DialogDescription>
          </DialogHeader>
          <FormField
            id="new-user-name"
            label={t('auth.username')}
            hint={t('auth.usernameHint')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
          />
          <PasswordField
            id="new-user-password"
            label={t('auth.users.initialPassword')}
            hint={t('auth.users.initialPasswordHint', { min: PASSWORD_MIN_LENGTH })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <RoleSelect id="new-user-role" value={role} onChange={setRole} />
          {ownGroups.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('auth.users.addGroups')}</legend>
              <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
                {ownGroups.map((g, i) => (
                  <li key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <input
                      id={`new-user-group-${i}`}
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={groupIds.has(g.id)}
                      onChange={(e) =>
                        setGroupIds((ids) => {
                          const next = new Set(ids);
                          if (e.target.checked) next.add(g.id);
                          else next.delete(g.id);
                          return next;
                        })
                      }
                    />
                    <label htmlFor={`new-user-group-${i}`} className="flex-1">
                      {g.name}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('auth.users.addGroupsHint')}</p>
            </fieldset>
          )}
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <DialogFooter>
            <Button type="submit" disabled={!valid || create.isPending || update.isPending}>
              {t('auth.users.addSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('auth.users.role')}
        </label>
        <HelpTip helpKey="auth.users.roleHelp" />
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
        <SelectTrigger id={id} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="user">{t('auth.roles.user')}</SelectItem>
          <SelectItem value="admin">{t('auth.roles.admin')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ResetPasswordDialog({ user }: { user: UserDto }) {
  const { t } = useTranslation();
  const { update } = useUserMutations();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const valid = password.length >= PASSWORD_MIN_LENGTH;
  const error = apiErrorOf(update.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPassword('');
          update.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('auth.users.resetPasswordFor', { name: user.username })}
        >
          <KeyRoundIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            update.mutate(
              { id: user.id, body: { password } },
              {
                onSuccess: () => {
                  toast.success(t('auth.users.passwordReset', { name: user.username }));
                  setOpen(false);
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('auth.users.resetPasswordFor', { name: user.username })}</DialogTitle>
            <DialogDescription>{t('auth.users.resetPasswordIntro')}</DialogDescription>
          </DialogHeader>
          <PasswordField
            id={`reset-${user.id}`}
            label={t('auth.account.newPassword')}
            hint={t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <DialogFooter>
            <Button type="submit" disabled={!valid || update.isPending}>
              {t('auth.users.resetPasswordSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Choice = 'group' | 'allow' | 'deny';
const CHOICES: readonly Choice[] = ['group', 'allow', 'deny'];

/** Groups and own allow/deny per function for one user. */
function AccessDialog({ user }: { user: UserDto }) {
  const { t } = useTranslation();
  const { update } = useUserMutations();
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<PermissionOverrides>({});
  const [manual, setManual] = useState<Set<string>>(new Set());
  const error = apiErrorOf(update.error);
  const all = groups.data ?? [];
  const own = all.filter((g) => g.builtin === null);
  // Memberships from LDAP or the proxy can't be changed here.
  const fixed = new Map(
    all.flatMap((g) =>
      g.members
        .filter((m) => m.userId === user.id && m.source !== 'manual')
        .map((m) => [g.id, m.source] as const),
    ),
  );
  const memberOf = (id: string) => fixed.has(id) || manual.has(id);
  // Preview: what the user may do with these settings.
  // Open unless one of the person's groups blocks it ("everyone" allows all).
  const byGroups = (f: Feature) => own.every((g) => !memberOf(g.id) || g.permissions[f] !== false);
  const effective = (f: Feature) =>
    user.role === 'admin' || (overrides[f] ? overrides[f] === 'allow' : byGroups(f));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setOverrides(user.permissionOverrides ?? {});
          setManual(
            new Set(
              all
                .filter((g) => g.members.some((m) => m.userId === user.id && m.source === 'manual'))
                .map((g) => g.id),
            ),
          );
        } else update.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('auth.users.accessFor', { name: user.username })}
          title={t('auth.users.accessFor', { name: user.username })}
        >
          <ShieldCheckIcon aria-hidden="true" />
          <span className="hidden sm:inline">{t('auth.users.access')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(
              { id: user.id, body: { permissionOverrides: overrides, groupIds: [...manual] } },
              {
                onSuccess: () => {
                  toast.success(t('auth.users.accessSaved', { name: user.username }));
                  setOpen(false);
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('auth.users.accessFor', { name: user.username })}</DialogTitle>
            <DialogDescription>{t('auth.users.accessIntro')}</DialogDescription>
          </DialogHeader>
          {user.role === 'admin' && (
            <p className="rounded-md bg-muted p-3 text-sm">{t('auth.users.adminAll')}</p>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('auth.users.groups')}</p>
            {own.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('auth.users.noGroups')}</p>
            ) : (
              <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
                {own.map((g) => {
                  const source = fixed.get(g.id);
                  return (
                    <li key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <input
                        id={`ug-${user.id}-${g.id}`}
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={memberOf(g.id)}
                        disabled={source !== undefined}
                        onChange={(e) =>
                          setManual((m) => {
                            const next = new Set(m);
                            if (e.target.checked) next.add(g.id);
                            else next.delete(g.id);
                            return next;
                          })
                        }
                      />
                      <label htmlFor={`ug-${user.id}-${g.id}`} className="flex-1">
                        {g.name}
                      </label>
                      {source && (
                        <span className="text-xs text-muted-foreground">
                          {t(`groups.memberSource.${source}`)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">{t('auth.users.functions')}</p>
              <HelpTip helpKey="auth.users.functionsHelp" labelKey="auth.users.functions" />
            </div>
            <ul className="divide-y rounded-md border">
              {FEATURES.map((f) => {
                const on = effective(f);
                const state = t(on ? 'auth.users.allowed' : 'auth.users.blocked');
                return (
                  <li
                    key={f}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-1.5 text-sm">
                      <span
                        className={
                          on ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                        }
                        role="img"
                        aria-label={state}
                        title={state}
                      >
                        {on ? '●' : '○'}
                      </span>
                      {t(`permissions.${f}.name`)}
                      <HelpTip
                        helpKey={`permissions.${f}.help`}
                        labelKey={`permissions.${f}.name`}
                      />
                    </div>
                    <Select
                      value={overrides[f] ?? 'group'}
                      onValueChange={(v) =>
                        setOverrides((o) => {
                          const next = Object.fromEntries(
                            Object.entries(o).filter(([key]) => key !== f),
                          ) as PermissionOverrides;
                          if (v !== 'group') next[f] = v as 'allow' | 'deny';
                          return next;
                        })
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-44"
                        aria-label={t('auth.users.choiceFor', { name: t(`permissions.${f}.name`) })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHOICES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t(`auth.users.choice.${c}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          </div>
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {t('auth.users.accessSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, isSelf }: { user: UserDto; isSelf: boolean }) {
  const { t } = useTranslation();
  const { update, remove, resetPin } = useUserMutations();
  const error = apiErrorOf(update.error) ?? apiErrorOf(remove.error) ?? apiErrorOf(resetPin.error);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {user.displayName || user.username}
            {isSelf && <span className="text-xs text-muted-foreground">{t('auth.users.you')}</span>}
            {user.authSource === 'ldap' && <Badge variant="secondary">LDAP</Badge>}
            {user.disabled && <Badge variant="destructive">{t('auth.users.disabled')}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">
            {user.username}
            {user.authSource === 'proxy' && ` · ${t('auth.users.viaProxy')}`}
            {user.authSource === 'ldap' && ` · ${t('auth.users.viaLdap')}`}
          </p>
          <p
            className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            aria-label={t('auth.users.groups')}
          >
            {user.groups && user.groups.length > 0
              ? user.groups.map((g) => (
                  <Badge key={g.id} variant="outline">
                    {g.name}
                  </Badge>
                ))
              : t('auth.users.onlyEveryone')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Select
            value={user.role}
            onValueChange={(role) => update.mutate({ id: user.id, body: { role: role as Role } })}
          >
            <SelectTrigger
              className="w-36"
              aria-label={t('auth.users.roleFor', { name: user.username })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{t('auth.roles.user')}</SelectItem>
              <SelectItem value="admin">{t('auth.roles.admin')}</SelectItem>
            </SelectContent>
          </Select>
          <AccessDialog user={user} />
          {user.hasPassword && user.authSource === 'local' && <ResetPasswordDialog user={user} />}
          {user.booruPin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('auth.users.resetBooruPinFor', { name: user.username })}
                  title={t('auth.users.resetBooruPinFor', { name: user.username })}
                >
                  <LockKeyholeOpenIcon aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('auth.users.resetBooruPinFor', { name: user.username })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('auth.users.resetBooruPinIntro')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('auth.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      resetPin.mutate(user.id, {
                        onSuccess: () =>
                          toast.success(t('auth.users.booruPinReset', { name: user.username })),
                      })
                    }
                  >
                    {t('auth.users.resetBooruPinSubmit')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={isSelf}
                aria-label={t('auth.users.deleteNamed', { name: user.username })}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('auth.users.deleteNamed', { name: user.username })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('auth.users.deleteWarning')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('auth.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate(user.id)}>
                  {t('auth.users.deleteConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </li>
  );
}

/** Administrators manage the accounts here. */
export function UsersCard() {
  const { t } = useTranslation();
  const me = useCurrentUser();
  const users = useUsers();
  if (me?.role !== 'admin') return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>{t('auth.users.title')}</CardTitle>
          <CardDescription>{t('auth.users.intro')}</CardDescription>
        </div>
        <CreateUserDialog />
      </CardHeader>
      <CardContent>
        {users.isError && (
          <ErrorMessage messageKey={apiErrorOf(users.error)?.messageKey ?? 'errors.internal'} />
        )}
        <ul className="divide-y">
          {users.data?.users.map((user) => (
            <UserRow key={user.id} user={user} isSelf={user.id === me.id} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
