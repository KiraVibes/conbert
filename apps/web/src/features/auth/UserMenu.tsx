import { GaugeIcon, LogOutIcon, SettingsIcon, UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStatus, useLogout } from './use-auth';

/** Account button in the header: who am I, settings, sign out. */
export function UserMenu({
  onOpenSettings,
  onOpenAdmin,
}: {
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
}) {
  const { t } = useTranslation();
  const status = useAuthStatus();
  const logout = useLogout();
  const user = status.data?.user;
  if (!user) return null;
  const name = user.displayName || user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('auth.menu.label', { name })}>
          <UserIcon aria-hidden="true" />
          <span className="hidden max-w-32 truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate">{name}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {user.username}
            <Badge variant="secondary">{t(`auth.roles.${user.role}`)}</Badge>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <SettingsIcon aria-hidden="true" />
          {t('settings.title')}
        </DropdownMenuItem>
        {user?.role === 'admin' && (
          <DropdownMenuItem onSelect={onOpenAdmin}>
            <GaugeIcon aria-hidden="true" />
            {t('admin.title')}
          </DropdownMenuItem>
        )}
        {status.data?.authMode === 'local' && (
          <DropdownMenuItem onSelect={() => logout.mutate()}>
            <LogOutIcon aria-hidden="true" />
            {t('auth.menu.logout')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
