# Setting up storage locations

Conbert can put finished files straight onto your NAS, a server or your own
cloud – and open files from there. You set this up once under **Settings →
Storage locations → “Add storage location”**. “Test connection” tells you
right away if everything is right.

Conbert stores passwords and keys **encrypted** and never shows them again.
Every storage location belongs to exactly one user.

> **Important:** Conbert runs on your server, not on your PC. The **server**
> has to be able to reach the NAS. If both are in the same home network, that
> is almost always the case.

## Network folder (SMB) – NAS, FritzBox, Windows PC

You need the **address of the shared folder**. Conbert understands all the
usual ways of writing it:

- `\\192.168.1.10\Photos` (as in Windows Explorer)
- `smb://nas.local/Photos` (as in the Mac Finder)

The part after the device (`Photos`) is the **share**. It doesn't work without
it.

**How do I find the address?**

- **Windows:** Open Explorer → “Network” on the left → double-click your NAS.
  The folders you now see are the shares. Click into the address bar at the
  top – it shows e.g. `\\DISKSTATION\Photos`.
- **Mac:** Finder → Go → “Connect to Server …”. The address starts with
  `smb://`.
- **Synology:** DSM → Control Panel → Shared Folder. The name there is the
  share; the IP address is under Control Panel → Network.
- **FritzBox:** The address is usually `\\fritz.box\FRITZ.NAS`. SMB has to be
  switched on under Home Network → Storage (NAS).
- **QNAP:** QTS → Control Panel → Shared Folders. The IP address is under
  Network & Virtual Switch.
- **Unraid:** “Shares” tab – the name there is the share. Under “SMB Security
  Settings”, “Export” has to be set to “Yes”. If Conbert runs on the same
  Unraid machine, a **folder on the server** (see below) is easier.

If the name (`nas.local`, `DISKSTATION`) doesn't work, use the **IP
address**: Docker containers often don't know the names in your home network.

## SFTP server

Server address, user name and password – just like an SSH login. In **expert
mode** you can paste a private SSH key (without a passphrase) instead of the
password. On Synology there is a “Start folder on the server”, e.g.
`/volume1`, so you can reach all shares.

## Nextcloud / WebDAV

You find the WebDAV address in Nextcloud at the bottom left under **Files
settings → WebDAV**. It looks like this:
`https://cloud.example.com/remote.php/dav/files/YOUR-NAME/`

Best use an **app password**: Nextcloud → Settings → Security → “Create new
app password”. That way you don't have to store your real password and can
revoke the access at any time.

## S3 storage (MinIO, Amazon S3, Backblaze B2, Wasabi …)

You need the server address (endpoint, leave it empty for Amazon), the name
of the **bucket**, and the access key ID and secret access key. The bucket
has to exist already – Conbert doesn't create one.

## Folder on the server

A folder on your hard disk (or an NFS mount) can be added directly. Add a line
under `volumes:` in `docker-compose.yml` – **always below `/storage`**:

```yaml
volumes:
  - conbert-data:/data
  - /mnt/disk/photos:/storage/photos
```

Then run `docker compose up -d`. The wizard then offers “Folder on the
server” with `/storage`. Other folders (e.g. `/etc` or Conbert's own data) are
blocked, also through links.

## Saving automatically

Under **Settings → Storage locations → “Save every conversion
automatically”** you choose a storage location. Every finished result then
also lands there – even if it was converted on your device. The file card
shows whether and where it was saved. You can still download the file.

## Who has to reach the NAS – my PC or Conbert?

**Always Conbert** (that is, the server or Docker container). Even when you
convert “On this device”, your browser sends the finished result to your
Conbert server, which puts it on the NAS. Your PC doesn't need access to the
NAS.

## The key for the passwords (`CONBERT_SECRET`)

Without a setting of your own, Conbert creates a random key in its data folder
on the first start. That works – but a key of your own in the `.env` file is
better, so that the key and the passwords aren't stored side by side:

```ini
CONBERT_SECRET=at-least-16-random-characters-here
```

`openssl rand -base64 32`, for example, creates a good key. **Keep it safe.**
If it changes, Conbert can no longer read the stored passwords – you then
have to enter them once again.

## Common errors

| Message                                           | What usually helps                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| “The storage location doesn't answer.”            | Is the device on? Use the IP address instead of the name. Check the firewall.               |
| “Signing in to the storage location didn't work.” | Check user name and password; for Nextcloud use an app password.                            |
| “This folder or file doesn't exist there.”        | Write the name of the share or bucket exactly as on the device.                             |
| “Access was denied.”                              | Give the user write permission for the folder on the NAS.                                   |
| “The encrypted connection was refused.”           | For FTPS with your own certificate, switch on “Don't check the certificate” in expert mode. |
