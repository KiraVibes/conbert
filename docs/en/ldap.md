# Groups, permissions and sign-in through LDAP

This guide is for admins. It explains

- how **groups** decide who may use which functions of Conbert,
- how people sign in with their **existing account from your directory**
  (LDAP) – for example Active Directory, OpenLDAP, lldap or your NAS's user
  directory,
- and how to take groups over from your **reverse proxy** (Authelia,
  Authentik …).

All of it is optional. Without any setup every account may do everything – just
like before.

---

## Contents

1. [Groups and permissions in one minute](#1-groups-and-permissions-in-one-minute)
2. [Which functions can I block?](#2-which-functions-can-i-block)
3. [Example: only the family may download videos](#3-example-only-the-family-may-download-videos)
4. [What is LDAP?](#4-what-is-ldap)
5. [Setting up LDAP](#5-setting-up-ldap)
6. [Taking groups over from LDAP](#6-taking-groups-over-from-ldap)
7. [Sync: whoever leaves is blocked](#7-sync-whoever-leaves-is-blocked)
8. [Groups from the reverse proxy](#8-groups-from-the-reverse-proxy)
9. [Common problems](#9-common-problems)

---

## 1. Groups and permissions in one minute

You find everything under **account menu → Administration → Groups**.

- Everyone is automatically in the group **“All users”**. Whatever is switched
  on there, everyone may do.
- Other groups **additionally allow** something. A function is available as soon
  as **at least one** of the person's groups allows it.
- Per person you can **always allow** or **always block** single functions under
  **Administration → Manage users → “Groups & permissions”**. That wins
  over all groups.
- **Administrators may always do everything.**

Blocked areas disappear from the navigation. If someone opens one anyway, they
see “This function is blocked for you”.

## 2. Which functions can I block?

| Function                 | What belongs to it                                                     |
| ------------------------ | ---------------------------------------------------------------------- |
| Convert & compress       | Start page and “Compress”                                              |
| Convert on the server    | Sending files to the server. Off = only on the own device              |
| Download                 | Videos/pictures from YouTube, Instagram & co., including subscriptions |
| Booru                    | Booru sites, tag search, booru subscriptions                           |
| Workflows                | Own processing chains, “Then automatically …”                          |
| Storage locations        | Set up and use NAS, SMB, Nextcloud, SFTP, S3                           |
| Swipe & similar pictures | Tidying up pictures on storage locations                               |
| AI tools                 | Whisper (speech → text), background removal, upscaling                 |
| Workshop                 | The FileWizard workshop                                                |
| PDF tools                | Merge, split, sort                                                     |
| API keys                 | Create access keys for scripts                                         |

**Important:** the workshop, the PDF tools and converting _on the device_ run
entirely in the browser. Conbert can only **hide** them – someone who knows
their way around could still open them. Everything that uses the server
(server conversion, downloader, booru, workflows, storage locations, AI, API
keys) is really blocked by the server – for API keys, too.

Subscriptions and workflows of a person whose function you take away rest
automatically until you allow it again.

## 3. Example: only the family may download videos

1. **Administration → Groups → edit “All users”** (pencil) and switch off
   “Download”. Save.
2. **Add group**: name “Family”, switch on “Download”, tick the members below.
   Save.
3. Done. Whoever is not in “Family” no longer sees “Download”.

## 4. What is LDAP?

LDAP is a **directory**: a central list of user accounts, passwords and groups.
Companies mostly use **Active Directory**, at home it is often **lldap**,
**OpenLDAP**, **Authentik** or the LDAP server of a **Synology/QNAP NAS**.

Once LDAP is set up in Conbert, Conbert checks user name and password with your
directory. On the first sign-in the person automatically gets a Conbert
account. Their password stays in the directory – Conbert doesn't store it.

Local Conbert accounts (e.g. your admin account from the setup) keep working,
even when the directory can't be reached. If there is a local account with the
same name as in the directory, the local account always wins – LDAP never takes
it over.

## 5. Setting up LDAP

**Administration → Sign-in through LDAP.** First click a **template**
(“OpenLDAP / lldap” or “Active Directory”), then enter:

| Field                           | What goes in                          | Example lldap                             | Example Active Directory         |
| ------------------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------- |
| Server address                  | `ldap://` or `ldaps://` + name + port | `ldap://lldap:3890`                       | `ldaps://dc01.company.local:636` |
| Service account (bind DN)       | Account Conbert searches with         | `uid=conbert,ou=people,dc=example,dc=com` | `conbert@company.local`          |
| Password of the service account | its password                          |                                           |                                  |
| Search base for users           | where the accounts are                | `ou=people,dc=example,dc=com`             | `dc=company,dc=local`            |
| Search base for groups          | where the groups are                  | `ou=groups,dc=example,dc=com`             | leave empty                      |

### How do I find the search base (base DN)?

- **lldap:** it's in your configuration as `LLDAP_LDAP_BASE_DN`, e.g.
  `dc=example,dc=com`. Users are below `ou=people,…`, groups below
  `ou=groups,…`.
- **Active Directory:** from the domain name: `company.local` →
  `dc=company,dc=local`.
- **Synology:** Control Panel → Domain/LDAP or LDAP Server → “Base DN”.

### Testing

Under **Test the connection** you can try the settings **before** saving. You
can also enter a test account: Conbert then shows whether signing in works and
which groups the person is in.

Then **“Switch on sign-in through LDAP”** and **Save**.

### Encryption

- `ldaps://` (usually port 636) is encrypted from the start – recommended.
- With `ldap://`, switch on **StartTLS** if your server supports it.
- Self-signed certificate? Paste the root certificate under **Advanced → Own CA
  certificate**. Only for trying things out, you can switch off “Check the
  server's certificate”.

### Only letting certain people in

Two ways:

1. Switch on **“Only members of imported groups may sign in”** and take the
   right groups over (see next section). The easiest way.
2. Extend the **user filter**, e.g.
   `(&(objectClass=person)(uid={{username}})(memberOf=cn=conbert,ou=groups,dc=example,dc=com))`.

## 6. Taking groups over from LDAP

**Administration → Groups → “Take over from LDAP”.** Search the groups, tick
them and take them over. Then decide per group (pencil) which functions it
allows.

- Conbert fills in the members **by itself** – at every sign-in and every sync.
  You don't need to tick anyone there (the names show “from LDAP” in the list).
- You can also add people **by hand**; they stay in during syncs.
- **“Members are administrators”**: whoever is in this group in the directory
  automatically becomes an admin in Conbert – and loses it again after leaving
  the group. The last admin is never removed.
- Groups in groups (nested) are not resolved. Add the person to the group
  directly.

## 7. Sync: whoever leaves is blocked

Conbert syncs with the directory regularly (default: every 6 hours, adjustable;
button **“Sync now”**):

- Group memberships and display names are updated.
- Accounts that **no longer exist** in the directory are **blocked** in Conbert
  and signed out everywhere. Their files stay until you delete the account. If
  the person shows up again, they can sign in again.

## 8. Groups from the reverse proxy

If your reverse proxy signs people in (see [Installation](installation.md)), it
can send their groups along, too:

```bash
# .env next to docker-compose.yml
CONBERT_AUTH_PROXY_HEADER=Remote-User
CONBERT_TRUSTED_PROXIES=172.18.0.1
CONBERT_PROXY_GROUPS_HEADER=Remote-Groups
```

- **Authelia** sends `Remote-Groups` (separated by commas).
- **Authentik** sends `X-authentik-groups` (separated by `|`).

Then enter the name the proxy sends (e.g. `family`) under **“Group name at the
reverse proxy”** of the matching Conbert group. Upper and lower case don't
matter. When the group changes at the proxy, it applies in Conbert with the
next page load.

Like the user name, the header only counts from the addresses in
`CONBERT_TRUSTED_PROXIES`.

## 9. Common problems

**“The LDAP server can't be reached.”**
The address or port is wrong, or Conbert runs in Docker and can't resolve the
name. If lldap is in the same docker-compose, use the service name
(`ldap://lldap:3890`), otherwise the IP address.

**“Conbert couldn't sign in to the LDAP server with the service account.”**
The bind DN or password is wrong. With Active Directory, `name@company.local`
often works instead of the long DN.

**The test says “This user doesn't exist”.**
The search base or user filter doesn't fit. Try the template for your
directory. With Active Directory the attribute must be `sAMAccountName`.

**Someone can't sign in although the password is right.**
Is “Only members of imported groups” on? Then the person must be in a group
you took over. Is there a **local** Conbert account with the same name? Then
its password counts.

**My password can't be changed in Conbert.**
That's right for LDAP accounts – change it in the directory.
