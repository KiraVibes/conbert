import { z } from 'zod';

/**
 * Functions an administrator can allow or block for groups and users.
 * Text keys: `permissions.<feature>.name` and `.help` in @conbert/i18n.
 *
 * Features that run only in the browser (convert on this device, workshop,
 * pdf) can only be hidden in the UI – the server never sees that work.
 */
export const FEATURES = [
  'convert',
  'serverConvert',
  'downloader',
  'booru',
  'workflows',
  'storage',
  'media',
  'ai',
  'workshop',
  'pdf',
  'apiTokens',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Server engines that count as "AI tools" (feature 'ai'). */
export const AI_ENGINE_IDS: readonly string[] = ['whisper', 'image-ai'];
export const featureSchema = z.enum(FEATURES);

/** Features the server can enforce (the rest is only hidden in the UI). */
export const SERVER_ENFORCED_FEATURES: readonly Feature[] = [
  'serverConvert',
  'downloader',
  'booru',
  'workflows',
  'storage',
  'media',
  'ai',
  'apiTokens',
];

/** Per feature: allowed or not. A missing key means "not set". */
export const featureMapSchema = z.partialRecord(featureSchema, z.boolean());
export type FeatureMap = z.infer<typeof featureMapSchema>;

/** A user's own setting per feature; missing = "like my groups". */
export const permissionOverrideSchema = z.enum(['allow', 'deny']);
export type PermissionOverride = z.infer<typeof permissionOverrideSchema>;
export const permissionOverridesSchema = z.partialRecord(featureSchema, permissionOverrideSchema);
export type PermissionOverrides = z.infer<typeof permissionOverridesSchema>;

export const authSourceSchema = z.enum(['local', 'ldap', 'proxy']);
export type AuthSource = z.infer<typeof authSourceSchema>;

// --- /api/groups (admin) ---
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** 'everyone' = the built-in group every user belongs to. */
  builtin: z.enum(['everyone']).nullable(),
  permissions: featureMapSchema,
  /** Members that come from LDAP or the proxy become administrators. */
  grantsAdmin: z.boolean(),
  /** Imported from this LDAP group (distinguished name). */
  ldapDn: z.string().nullable(),
  /** Matches this group name from the reverse proxy's groups header. */
  proxyName: z.string().nullable(),
  members: z.array(
    z.object({
      userId: z.string(),
      username: z.string(),
      source: z.enum(['manual', 'ldap', 'proxy']),
    }),
  ),
});
export type GroupDto = z.infer<typeof groupSchema>;

export const groupsResponseSchema = z.object({ groups: z.array(groupSchema) });
export type GroupsResponse = z.infer<typeof groupsResponseSchema>;
export const groupResponseSchema = z.object({ group: groupSchema });
export type GroupResponse = z.infer<typeof groupResponseSchema>;

const groupNameSchema = z.string().trim().min(1).max(64);

export const createGroupRequestSchema = z.object({
  name: groupNameSchema,
  description: z.string().trim().max(200).optional(),
  permissions: featureMapSchema.default({}),
  grantsAdmin: z.boolean().default(false),
  proxyName: z.string().trim().max(128).nullable().optional(),
});
export type CreateGroupRequest = z.input<typeof createGroupRequestSchema>;

export const updateGroupRequestSchema = z
  .object({
    name: groupNameSchema.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: featureMapSchema.optional(),
    grantsAdmin: z.boolean().optional(),
    proxyName: z.string().trim().max(128).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type UpdateGroupRequest = z.input<typeof updateGroupRequestSchema>;

/** Replaces the hand-picked members (LDAP/proxy members stay). */
export const groupMembersRequestSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).max(10_000),
});
