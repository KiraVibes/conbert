import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRoundIcon, LockKeyholeOpenIcon, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  PASSWORD_MIN_LENGTH,
  userResponseSchema,
  usersResponseSchema,
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
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { FormField, PasswordField } from './FormField';
import { useCurrentUser } from './use-auth';

const USERS_KEY = ['users'] as const;

function apiErrorOf(error: unknown): ApiRequestError | null {
  return error instanceof ApiRequestError ? error : null;
}

function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: ({ signal }) => apiGet('/api/users', usersResponseSchema, { signal }),
  });
}

function useUserMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
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
  const { create } = useUserMutations();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const valid = username.trim().length >= 2 && password.length >= PASSWORD_MIN_LENGTH;
  const error = apiErrorOf(create.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUsername('');
          setPassword('');
          setRole('user');
          create.reset();
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
                onSuccess: () => {
                  toast.success(t('auth.users.created', { name: username }));
                  setOpen(false);
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
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <DialogFooter>
            <Button type="submit" disabled={!valid || create.isPending}>
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

function UserRow({ user, isSelf }: { user: UserDto; isSelf: boolean }) {
  const { t } = useTranslation();
  const { update, remove, resetPin } = useUserMutations();
  const error = apiErrorOf(update.error) ?? apiErrorOf(remove.error) ?? apiErrorOf(resetPin.error);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">
            {user.displayName || user.username}
            {isSelf && (
              <span className="ml-2 text-xs text-muted-foreground">{t('auth.users.you')}</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {user.username}
            {!user.hasPassword && ` · ${t('auth.users.viaProxy')}`}
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
          {user.hasPassword && <ResetPasswordDialog user={user} />}
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
