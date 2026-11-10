import { useState } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  FEATURES,
  SERVER_ENFORCED_FEATURES,
  type Feature,
  type FeatureMap,
  type GroupDto,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { FormField } from '@/features/auth/FormField';
import { useUsers } from '@/features/auth/users-api';
import { ApiRequestError } from '@/lib/api';
import { groupName, useGroupMutations, useGroups } from './groups-api';

/** Is the function switched on in this group? "Everyone" allows what it doesn't forbid. */
function isOn(group: Pick<GroupDto, 'builtin'>, permissions: FeatureMap, feature: Feature) {
  return group.builtin === 'everyone'
    ? permissions[feature] !== false
    : permissions[feature] === true;
}

/** One switch per function, each with a plain explanation. */
export function FeatureSwitches({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: (feature: Feature) => boolean;
  onChange: (feature: Feature, on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-md border">
      {FEATURES.map((feature) => (
        <li key={feature} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`${idPrefix}-${feature}`} className="text-sm">
              {t(`permissions.${feature}.name`)}
            </label>
            <HelpTip
              helpKey={`permissions.${feature}.help`}
              labelKey={`permissions.${feature}.name`}
              effectKey={
                SERVER_ENFORCED_FEATURES.includes(feature) ? undefined : 'permissions.onlyHidden'
              }
            />
          </div>
          <Switch
            id={`${idPrefix}-${feature}`}
            checked={value(feature)}
            onCheckedChange={(on) => onChange(feature, on)}
          />
        </li>
      ))}
    </ul>
  );
}

function GroupDialog({
  group,
  open,
  onOpenChange,
}: {
  /** null = new group. */
  group: GroupDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const users = useUsers();
  const { create, update, setMembers } = useGroupMutations();
  const everyone = group?.builtin === 'everyone';
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [permissions, setPermissions] = useState<FeatureMap>(group?.permissions ?? {});
  const [grantsAdmin, setGrantsAdmin] = useState(group?.grantsAdmin ?? false);
  const [proxyName, setProxyName] = useState(group?.proxyName ?? '');
  const [members, setMemberIds] = useState<Set<string>>(
    new Set(group?.members.filter((m) => m.source === 'manual').map((m) => m.userId)),
  );
  const fixed = new Map(
    group?.members.filter((m) => m.source !== 'manual').map((m) => [m.userId, m.source]),
  );
  const pending = create.isPending || update.isPending || setMembers.isPending;
  const failed = create.error ?? update.error ?? setMembers.error;
  const error = failed instanceof ApiRequestError ? failed : null;
  const shape = { builtin: group?.builtin ?? null };

  const save = async () => {
    try {
      let id = group?.id;
      if (everyone) {
        await update.mutateAsync({ id: id ?? '', body: { permissions } });
      } else {
        const body = {
          name: name.trim(),
          description: description.trim() || null,
          permissions,
          grantsAdmin,
          proxyName: proxyName.trim() || null,
        };
        if (id) await update.mutateAsync({ id, body });
        else
          id = (await create.mutateAsync({ ...body, description: body.description ?? undefined }))
            .group.id;
        await setMembers.mutateAsync({ id, userIds: [...members] });
      }
      toast.success(t('groups.saved'));
      onOpenChange(false);
    } catch {
      // Shown in the dialog.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (everyone || name.trim()) void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {group ? t('groups.editTitle', { name: groupName(t, group) }) : t('groups.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {everyone ? t('groups.everyoneIntro') : t('groups.dialogIntro')}
            </DialogDescription>
          </DialogHeader>
          {!everyone && (
            <>
              <FormField
                id="group-name"
                label={t('groups.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
              />
              <FormField
                id="group-description"
                label={t('groups.description')}
                hint={t('groups.descriptionHint')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('groups.functions')}</p>
            <p className="text-xs text-muted-foreground">{t('groups.functionsHint')}</p>
            <FeatureSwitches
              idPrefix="group-feature"
              value={(f) => isOn(shape, permissions, f)}
              onChange={(f, on) => setPermissions((p) => ({ ...p, [f]: on }))}
            />
          </div>
          {!everyone && (
            <>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('groups.members')}</p>
                {users.data?.users.length ? (
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                    {users.data.users.map((u) => {
                      const source = fixed.get(u.id);
                      return (
                        <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                          <input
                            id={`member-${u.id}`}
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={source !== undefined || members.has(u.id)}
                            disabled={source !== undefined}
                            onChange={(e) =>
                              setMemberIds((m) => {
                                const next = new Set(m);
                                if (e.target.checked) next.add(u.id);
                                else next.delete(u.id);
                                return next;
                              })
                            }
                          />
                          <label htmlFor={`member-${u.id}`} className="flex-1">
                            {u.displayName || u.username}
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
                ) : (
                  <p className="text-sm text-muted-foreground">{t('groups.noUsers')}</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="group-admin" className="text-sm font-medium">
                    {t('groups.grantsAdmin')}
                  </label>
                  <HelpTip helpKey="groups.grantsAdminHelp" labelKey="groups.grantsAdmin" />
                </div>
                <Switch id="group-admin" checked={grantsAdmin} onCheckedChange={setGrantsAdmin} />
              </div>
              <FormField
                id="group-proxy"
                label={t('groups.proxyName')}
                hint={t('groups.proxyNameHint')}
                helpKey="groups.proxyNameHelp"
                value={proxyName}
                onChange={(e) => setProxyName(e.target.value)}
                maxLength={128}
              />
              {group?.ldapDn && (
                <p className="text-xs break-all text-muted-foreground">
                  {t('groups.ldapDn', { dn: group.ldapDn })}
                </p>
              )}
            </>
          )}
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          <DialogFooter>
            <Button type="submit" disabled={pending || (!everyone && !name.trim())}>
              {t('groups.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GroupRow({ group, onEdit }: { group: GroupDto; onEdit: () => void }) {
  const { t } = useTranslation();
  const { remove } = useGroupMutations();
  const allowed = FEATURES.filter((f) => isOn(group, group.permissions, f));
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 font-medium">
          {groupName(t, group)}
          {group.ldapDn && <Badge variant="secondary">LDAP</Badge>}
          {group.proxyName && <Badge variant="secondary">{t('groups.badgeProxy')}</Badge>}
          {group.grantsAdmin && <Badge>{t('auth.roles.admin')}</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          {group.builtin === 'everyone'
            ? t('groups.everyoneMembers')
            : t('groups.memberCount', { count: group.members.length })}
          {' · '}
          {allowed.length === FEATURES.length
            ? t('groups.allFunctions')
            : allowed.length === 0
              ? t('groups.noFunctions')
              : t('groups.someFunctions', { count: allowed.length, total: FEATURES.length })}
        </p>
        {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={t('groups.editTitle', { name: groupName(t, group) })}
          title={t('groups.editTitle', { name: groupName(t, group) })}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        {group.builtin === null && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('groups.deleteNamed', { name: group.name })}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('groups.deleteNamed', { name: group.name })}</AlertDialogTitle>
                <AlertDialogDescription>{t('groups.deleteWarning')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('auth.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate(group.id)}>
                  {t('groups.deleteConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </li>
  );
}

/** Groups decide which functions their members may use. */
export function GroupsCard({ importButton }: { importButton?: React.ReactNode }) {
  const { t } = useTranslation();
  const groups = useGroups();
  // key changes on every open so the dialog starts with fresh values.
  const [editing, setEditing] = useState<{ group: GroupDto | null; key: number } | null>(null);
  const error = groups.error instanceof ApiRequestError ? groups.error : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="size-5" aria-hidden="true" />
            {t('groups.title')}
            <HelpTip helpKey="groups.help" labelKey="groups.title" />
          </CardTitle>
          <CardDescription>{t('groups.intro')}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {importButton}
          <Button size="sm" onClick={() => setEditing({ group: null, key: Date.now() })}>
            <PlusIcon aria-hidden="true" />
            {t('groups.add')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {groups.isError && (
          <ErrorMessage
            messageKey={error?.messageKey ?? 'errors.network'}
            details={error?.details}
          />
        )}
        <ul className="divide-y">
          {groups.data?.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              onEdit={() => setEditing({ group, key: Date.now() })}
            />
          ))}
        </ul>
      </CardContent>
      {editing && (
        <GroupDialog
          key={editing.key}
          group={editing.group}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
    </Card>
  );
}
