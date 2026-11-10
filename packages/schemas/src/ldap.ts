import { z } from 'zod';

/** A placeholder in the user filter that is replaced by the (escaped) login name. */
export const LDAP_USERNAME_PLACEHOLDER = '{{username}}';

const attr = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/, 'LDAP attribute name');
const dn = z.string().trim().max(1024);
const filter = z
  .string()
  .trim()
  .max(1024)
  .refine((f) => f === '' || (f.startsWith('(') && f.endsWith(')')), 'filter in parentheses');

/** Connection and search settings (without the bind password). */
export const ldapConfigSchema = z.object({
  enabled: z.boolean(),
  /** ldap://host:389 or ldaps://host:636 */
  url: z
    .string()
    .trim()
    .max(512)
    .refine((u) => u === '' || /^ldaps?:\/\/[^\s/]+\/?$/i.test(u), 'ldap:// or ldaps:// address'),
  startTls: z.boolean(),
  /** false = accept any certificate (self-signed, test setups). */
  tlsVerify: z.boolean(),
  /** Own certificate authority in PEM format (optional). */
  caCert: z.string().trim().max(20_000),
  bindDn: dn,
  userBase: dn,
  userFilter: filter.refine(
    (f) => f === '' || f.includes(LDAP_USERNAME_PLACEHOLDER),
    `user filter needs ${LDAP_USERNAME_PLACEHOLDER}`,
  ),
  usernameAttr: attr,
  displayNameAttr: attr,
  groupBase: dn,
  groupFilter: filter,
  groupNameAttr: attr,
  /** member (groupOfNames, AD), uniqueMember (groupOfUniqueNames) or memberUid (posixGroup). */
  memberAttr: attr,
  /** Only members of imported LDAP groups may sign in. */
  onlyImportedGroups: z.boolean(),
  /** Hours between automatic syncs; 0 = only at sign-in and by hand. */
  syncHours: z.number().int().min(0).max(168),
});
export type LdapConfig = z.infer<typeof ldapConfigSchema>;

export const ldapSyncStatusSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  users: z.number(),
  groups: z.number(),
  disabled: z.number(),
  errorKey: z.string().nullable(),
});
export type LdapSyncStatus = z.infer<typeof ldapSyncStatusSchema>;

// --- GET/PUT /api/admin/ldap ---
export const ldapSettingsResponseSchema = z.object({
  settings: ldapConfigSchema.extend({
    hasBindPassword: z.boolean(),
    lastSync: ldapSyncStatusSchema.nullable(),
  }),
});
export type LdapSettingsResponse = z.infer<typeof ldapSettingsResponseSchema>;
export type LdapSettingsDto = LdapSettingsResponse['settings'];

/** bindPassword: undefined = keep the stored one, '' = remove it. */
export const ldapSettingsRequestSchema = ldapConfigSchema.extend({
  bindPassword: z.string().max(1024).optional(),
});
export type LdapSettingsRequest = z.input<typeof ldapSettingsRequestSchema>;

// --- POST /api/admin/ldap/test ---
export const ldapTestRequestSchema = z.object({
  settings: ldapSettingsRequestSchema,
  /** Optional: try a sign-in with this account, too. */
  username: z.string().trim().toLowerCase().max(64).optional(),
  password: z.string().max(1024).optional(),
});
export type LdapTestRequest = z.input<typeof ldapTestRequestSchema>;

export const ldapTestResponseSchema = z.object({
  users: z.number(),
  groups: z.number(),
  login: z
    .object({
      ok: z.boolean(),
      /** Why it failed: 'notFound' | 'wrongPassword' | 'notInGroup'. */
      reason: z.enum(['notFound', 'wrongPassword', 'notInGroup']).nullable(),
      dn: z.string().nullable(),
      displayName: z.string().nullable(),
      groups: z.array(z.string()),
    })
    .nullable(),
});
export type LdapTestResponse = z.infer<typeof ldapTestResponseSchema>;

// --- GET /api/admin/ldap/groups ---
export const ldapGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      dn: z.string(),
      name: z.string(),
      members: z.number(),
      /** Already a Conbert group. */
      imported: z.boolean(),
    }),
  ),
  /** More groups than shown – narrow the search. */
  truncated: z.boolean(),
});
export type LdapGroupsResponse = z.infer<typeof ldapGroupsResponseSchema>;

// --- POST /api/admin/ldap/import ---
export const ldapImportRequestSchema = z.object({
  dns: z.array(dn.min(1)).min(1).max(500),
});

// --- POST /api/admin/ldap/sync ---
export const ldapSyncResponseSchema = z.object({ status: ldapSyncStatusSchema });
