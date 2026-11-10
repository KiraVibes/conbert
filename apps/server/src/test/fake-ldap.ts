import { FilterParser } from 'ldapts';
import { LdapInvalidCredentials, type LdapConnector, type LdapEntry } from '../auth/ldap/client';
import { normalizeDn } from '../auth/ldap/directory';
import { HttpError } from '../lib/http-error';

export interface FakeEntry {
  dn: string;
  attrs: Record<string, string[]>;
  password?: string;
}

/** The parsed filter tree of ldapts (only the parts the fake needs). */
interface FilterNode {
  type: number;
  filters?: FilterNode[];
  filter?: FilterNode;
  attribute?: string;
  value?: string;
  initial?: string;
  any?: string[];
  final?: string;
}

function values(entry: FakeEntry, attribute: string): string[] {
  const key = Object.keys(entry.attrs).find((k) => k.toLowerCase() === attribute.toLowerCase());
  return key ? (entry.attrs[key] ?? []) : [];
}

function matches(node: FilterNode, entry: FakeEntry): boolean {
  switch (node.type) {
    case 160: // and
      return (node.filters ?? []).every((f) => matches(f, entry));
    case 161: // or
      return (node.filters ?? []).some((f) => matches(f, entry));
    case 162: // not
      return node.filter ? !matches(node.filter, entry) : true;
    case 135: // presence
      return values(entry, node.attribute ?? '').length > 0;
    case 163: {
      // equality (DN-valued attributes compare normalized)
      const wanted = normalizeDn(node.value ?? '');
      return values(entry, node.attribute ?? '').some((v) => normalizeDn(v) === wanted);
    }
    case 164: {
      // substring
      const parts = [node.initial ?? '', ...(node.any ?? []), node.final ?? ''].map((p) =>
        p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      );
      const re = new RegExp(`^${parts.join('.*')}$`);
      return values(entry, node.attribute ?? '').some((v) => re.test(v.toLowerCase()));
    }
    default:
      throw new Error(`fake ldap: filter type ${node.type}`);
  }
}

/** An in-memory directory. Change `entries` or `down` during a test. */
export function fakeLdap(entries: FakeEntry[]) {
  const state = { entries, down: false, binds: [] as string[], searches: [] as string[] };
  const connector: LdapConnector = async () => {
    if (state.down) throw new HttpError(502, 'LDAP_UNREACHABLE', 'ECONNREFUSED');
    return {
      async bind(dn, password) {
        state.binds.push(dn);
        const entry = state.entries.find((e) => normalizeDn(e.dn) === normalizeDn(dn));
        if (!password || !entry || entry.password !== password) throw new LdapInvalidCredentials();
      },
      async search(base, options) {
        state.searches.push(options.filter);
        const root = normalizeDn(base);
        const tree = FilterParser.parseString(options.filter) as unknown as FilterNode;
        return state.entries
          .filter((e) => {
            const dn = normalizeDn(e.dn);
            return options.scope === 'base' ? dn === root : dn === root || dn.endsWith(`,${root}`);
          })
          .filter((e) => matches(tree, e))
          .map((e): LdapEntry => {
            const attrs: Record<string, string[]> = {};
            for (const a of options.attributes) {
              const v = values(e, a);
              if (v.length) attrs[a.toLowerCase()] = v;
            }
            return { dn: e.dn, attrs };
          });
      },
      async close() {},
    };
  };
  return { state, connector };
}

/** A small OpenLDAP-like directory: two people, two groups, a service account. */
export function sampleDirectory(): FakeEntry[] {
  return [
    {
      dn: 'cn=conbert,ou=services,dc=home',
      attrs: { objectClass: ['person'] },
      password: 'svc-pw',
    },
    {
      dn: 'uid=bea,ou=people,dc=home',
      attrs: { objectClass: ['person'], uid: ['bea'], cn: ['Bea Beispiel'] },
      password: 'bea-ldap-pw',
    },
    {
      dn: 'uid=carl,ou=people,dc=home',
      attrs: { objectClass: ['person'], uid: ['carl'], cn: ['Carl'] },
      password: 'carl-ldap-pw',
    },
    {
      dn: 'cn=family,ou=groups,dc=home',
      attrs: {
        objectClass: ['groupOfNames'],
        cn: ['family'],
        member: ['uid=bea,ou=people,dc=home', 'uid=carl,ou=people,dc=home'],
      },
    },
    {
      dn: 'cn=admins,ou=groups,dc=home',
      attrs: {
        objectClass: ['groupOfNames'],
        cn: ['admins'],
        member: ['uid=carl,ou=people,dc=home'],
      },
    },
  ];
}

export const SAMPLE_LDAP_SETTINGS = {
  enabled: true,
  url: 'ldap://directory.test:389',
  startTls: false,
  tlsVerify: true,
  caCert: '',
  bindDn: 'cn=conbert,ou=services,dc=home',
  bindPassword: 'svc-pw',
  userBase: 'ou=people,dc=home',
  userFilter: '(&(objectClass=person)(uid={{username}}))',
  usernameAttr: 'uid',
  displayNameAttr: 'cn',
  groupBase: 'ou=groups,dc=home',
  groupFilter: '(objectClass=groupOfNames)',
  groupNameAttr: 'cn',
  memberAttr: 'member',
  onlyImportedGroups: false,
  syncHours: 6,
};
