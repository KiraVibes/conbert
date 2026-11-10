import { eq } from 'drizzle-orm';
import type {
  LdapConfig,
  LdapSettingsDto,
  LdapSettingsRequest,
  LdapSyncStatus,
} from '@conbert/schemas';
import type { DbOrTx } from '../../db';
import { appSettings } from '../../db/schema';
import type { SecretBox } from '../../lib/secret-box';

const KEY = 'ldap';
/** Binds the encrypted password to this setting, so it can't be moved elsewhere. */
const SECRET_CONTEXT = 'app-settings:ldap:bind-password';

/** OpenLDAP / lldap style – a sensible start for most home servers. */
export const LDAP_DEFAULTS: LdapConfig = {
  enabled: false,
  url: '',
  startTls: false,
  tlsVerify: true,
  caCert: '',
  bindDn: '',
  userBase: '',
  userFilter: '(&(objectClass=person)(uid={{username}}))',
  usernameAttr: 'uid',
  displayNameAttr: 'cn',
  groupBase: '',
  groupFilter: '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))',
  groupNameAttr: 'cn',
  memberAttr: 'member',
  onlyImportedGroups: false,
  syncHours: 6,
};

interface Stored extends LdapConfig {
  /** Encrypted with the secret box; null = none. */
  bindPasswordBox: string | null;
  lastSync: LdapSyncStatus | null;
}

/** The settings with the bind password decrypted (server side only). */
export interface LdapSettings extends LdapConfig {
  bindPassword: string;
  lastSync: LdapSyncStatus | null;
}

function readStored(db: DbOrTx): Stored {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const value = (row?.value ?? {}) as Partial<Stored>;
  return { ...LDAP_DEFAULTS, bindPasswordBox: null, lastSync: null, ...value };
}

function writeStored(db: DbOrTx, value: Stored): void {
  db.insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function getLdapSettings(db: DbOrTx, secrets: SecretBox): LdapSettings {
  const { bindPasswordBox, ...rest } = readStored(db);
  let bindPassword = '';
  if (bindPasswordBox) {
    try {
      bindPassword = secrets.decrypt(bindPasswordBox, SECRET_CONTEXT);
    } catch {
      // Key changed (CONBERT_SECRET): the admin has to enter it again.
      bindPassword = '';
    }
  }
  return { ...rest, bindPassword };
}

/** For the API: never the password itself. */
export function ldapSettingsDto(db: DbOrTx): LdapSettingsDto {
  const { bindPasswordBox, ...rest } = readStored(db);
  return { ...rest, hasBindPassword: bindPasswordBox !== null };
}

export function saveLdapSettings(
  db: DbOrTx,
  secrets: SecretBox,
  request: LdapSettingsRequest & LdapConfig,
): void {
  const current = readStored(db);
  const { bindPassword, ...config } = request;
  const bindPasswordBox =
    bindPassword === undefined
      ? current.bindPasswordBox
      : bindPassword === ''
        ? null
        : secrets.encrypt(bindPassword, SECRET_CONTEXT);
  writeStored(db, { ...current, ...config, bindPasswordBox });
}

/** Settings from an (unsaved) form, with the stored password if none was typed. */
export function mergeWithStoredPassword(
  db: DbOrTx,
  secrets: SecretBox,
  request: LdapSettingsRequest & LdapConfig,
): LdapSettings {
  const stored = getLdapSettings(db, secrets);
  const { bindPassword, ...config } = request;
  return {
    ...config,
    bindPassword: bindPassword ?? stored.bindPassword,
    lastSync: stored.lastSync,
  };
}

export function setLastSync(db: DbOrTx, status: LdapSyncStatus): void {
  writeStored(db, { ...readStored(db), lastSync: status });
}

/** LDAP is on and has what it needs to search. */
export function ldapReady(settings: LdapConfig): boolean {
  return (
    settings.enabled &&
    settings.url !== '' &&
    settings.userBase !== '' &&
    settings.userFilter !== ''
  );
}
