# Installing Conbert (with Docker)

This guide gets Conbert running on a computer or NAS in your home network. You
don't need any programming skills – just a few commands to type in. Allow about
15 minutes (plus download time).

**Short version for the impatient:**

```bash
mkdir conbert && cd conbert
curl -fsSLO https://raw.githubusercontent.com/OWNER/conbert/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/OWNER/conbert/main/.env.example
docker compose up -d
docker compose logs conbert  # shows the setup code
```

Then open `http://localhost:3313` in your browser and enter the code.

---

## 1. What you need

- A computer that runs all the time: e.g. a NAS (Synology, QNAP, Unraid,
  TrueNAS), a mini PC, a Raspberry Pi 4/5 or your PC.
- **At least 2 GB of RAM** (better 4 GB if you convert videos) and about
  **5 GB of free space** for the program.
- **Docker** with “Docker Compose”:
  - Windows / Mac: install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
  - Linux: `curl -fsSL https://get.docker.com | sh` (then log out and back in
    once).
  - Synology: install **Container Manager** from the Package Center.
  - QNAP: install **Container Station** from the App Center.
  - Unraid: Docker is already included; for Compose install the “Docker
    Compose Manager” plugin.

Check that it works: type `docker compose version` in a terminal. A version
number should appear.

> **Terminal?** On Windows it's called “PowerShell” or “Terminal” (Start
> menu), on the Mac “Terminal” (Applications → Utilities). On a NAS you log in
> via SSH (on Synology: Control Panel → Terminal & SNMP → enable SSH, then
> `ssh yourname@<IP-of-the-NAS>`).

## 2. Downloading Conbert

You only need two small files. Docker downloads the actual program (the
“Docker image”) by itself when it starts – ready-built, for ordinary PCs and
NAS devices (amd64) as well as ARM devices like the Raspberry Pi.

Create a folder and download the files into it:

```bash
mkdir conbert && cd conbert
curl -fsSLO https://raw.githubusercontent.com/OWNER/conbert/main/docker-compose.yml
curl -fsSL -o .env.example https://raw.githubusercontent.com/OWNER/conbert/main/.env.example
```

It also works without a terminal: open both addresses in your browser, save
the files under exactly these names (`docker-compose.yml`, `.env.example`)
and put them together in one folder. On a NAS you can create the folder via
its file sharing, for example.

> **Build it yourself instead of downloading?** If you want to change the
> source code, clone the repository (`git clone https://github.com/OWNER/conbert.git`)
> and start with
> `docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d`.
> The first time this takes 10 to 30 minutes.

## 3. Settings in the `.env` file (optional, but recommended)

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` with a text editor. Everything in it is optional – the most
important points:

| Setting                 | What for                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| `CONBERT_PORT`          | Which port Conbert can be reached on (default `3313`).                    |
| `CONBERT_SECRET`        | Key for stored passwords – see below.                                     |
| `CONBERT_MAX_UPLOAD_MB` | Largest file you may upload (default 2048 = 2 GB).                        |
| `CONBERT_MEMORY_LIMIT`  | How much RAM Conbert may use at most (e.g. `4g`).                         |
| `CONBERT_IMAGE_TAG`     | `full` for e-book formats such as MOBI and AZW3 (image grows by ~850 MB). |

A line starting with `#` is switched off. To switch it on, remove the `#`.

### The `CONBERT_SECRET` key – what is it?

When you store storage locations (NAS shares, Nextcloud …) or cookies in
Conbert, Conbert saves the passwords **encrypted**. The key for this is
`CONBERT_SECRET`.

- **If you don't set it**, Conbert creates a random key on the first start
  and puts it in its data folder (`/data/secret.key`). That works – but then
  the key and the encrypted passwords sit side by side. Anyone with a copy of
  the data folder has both.
- **Better:** put a key of your own into `.env`. You create a good one like
  this:

  ```bash
  openssl rand -base64 32
  ```

  (Without `openssl`: any random string of at least 16 characters, e.g. from
  a password manager.) Then in `.env`:

  ```ini
  CONBERT_SECRET=the-generated-string-here
  ```

- **Keep the key safe** (e.g. in your password manager). If it gets lost or
  you change it, Conbert can no longer read the stored passwords. You then
  have to enter them once again for the storage locations and cookies – no
  files are lost.
- The same applies if you later switch from the automatically created key to
  one of your own: enter the passwords once again.

## 4. Starting

```bash
docker compose up -d
```

The first time, Docker downloads the program. It is big (about 3.5 GB
unpacked) because it includes many conversion tools – depending on your
internet connection this takes **a few minutes**. After that, Conbert starts
in a few seconds.

Is it running? `docker compose ps` shows the state `healthy` for `conbert`.

## 5. Setting up

1. Get the **setup code** from the log:

   ```bash
   docker compose logs conbert
   ```

   It is in a box saying “Conbert is not set up yet”.

2. Open it in your browser:
   - on the same device: `http://localhost:3313`
   - from another device in your home network: `http://<IP-of-the-server>:3313`
     (you find the IP e.g. in your router or on Synology under Control Panel →
     Network)

3. Enter the code and create your **admin account** (user name and a password
   with at least 10 characters). You add more accounts afterwards under
   **Administration**.

   Alternative: let your reverse proxy handle the login – only if you already
   use Authelia, Authentik or similar (see `.env.example`).

## 6. HTTPS – why and how?

Conbert works via `http://<IP>:3313`, but your browser then blocks some
features for security reasons:

- **Converting “On this device”** (for some tools – Conbert then falls back
  to the server),
- **Offline use** and **installing as an app** (including “Share → Conbert”
  on your phone).

Everything works on `http://localhost:3313`. For the other devices you need
**HTTPS**, i.e. an encrypted address such as `https://conbert.my-domain.com`.
A **reverse proxy** does this, for example:

- **Nginx Proxy Manager** (simple, with a user interface),
- **Caddy** (one line of configuration: `conbert.example.com { reverse_proxy conbert:3313 }`),
- **Traefik**,
- on Synology: Control Panel → Login Portal → Advanced → Reverse Proxy.

Important: the proxy has to let **WebSockets** through (for the progress) and
allow large uploads (e.g. `client_max_body_size 2g;` for Nginx).

For **Nginx** there is a ready-made template in
[reverse-proxy/nginx.conf](../reverse-proxy/nginx.conf) – HTTP only,
`certbot --nginx` adds the certificate afterwards. The important part: Nginx
has to pass on the real `Host`, otherwise Conbert refuses sign-in and uploads.

## 7. Limits for RAM and CPU (for small NAS devices)

Converting videos takes a lot of power. So that your NAS stays usable
alongside, you can limit Conbert – in `.env`:

```ini
CONBERT_MEMORY_LIMIT=3g     # at most 3 GB of RAM
CONBERT_CPUS=2              # at most 2 CPU cores
CONBERT_JOB_CONCURRENCY=1   # only one conversion on the server at a time
```

Then run `docker compose up -d`. If the memory isn't enough for a file, only
that conversion stops with an understandable message – everything else keeps
running. Conversions also run with lower priority so the interface stays
smooth.

## 8. Adding folders and NAS shares

Conbert can save results directly on your NAS and open files from there. How
to find the address of your share is described in [storage.md](storage.md).

Folders that are directly on the server are added in `docker-compose.yml`
under `volumes:`, e.g.:

```yaml
- /volume1/photos:/storage/photos
```

## 9. Graphics card for faster videos (optional)

`docker-compose.yml` contains commented-out examples for Intel/AMD
(`/dev/dri`) and NVIDIA. Uncomment them, run `docker compose up -d`, done.
Under **Settings → Engines** you can see whether Conbert has detected the
card.

## 10. Updating

```bash
docker compose pull
docker compose up -d
```

Docker only downloads what has changed. To stay on a specific version, put
it in `.env`, e.g. `CONBERT_IMAGE_TAG=0.1.0`. The project's release page on
GitHub lists the versions and what's new.

If you built it yourself: `git pull`, then again
`docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d`.

Your accounts, settings and storage locations are kept (they live in the
Docker volume `conbert-data`).

## 11. Backing up

Everything important is in the `conbert-data` volume. This is how you back it
up into a file:

```bash
docker run --rm -v conbert_conbert-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/conbert-backup.tar.gz -C /data .
```

(The volume name starts with the folder name, here `conbert_`. `docker volume
ls` shows the exact name.) Also back up your `.env` – especially
`CONBERT_SECRET`.

## 12. Forgot the admin password

If there is another admin, they can reset your password under
**Administration**. If you are the only admin, reset it directly on the
server:

```bash
docker compose exec conbert node server/dist/index.mjs reset-password admin
```

(Replace `admin` with your user name.) Conbert shows a new random password and
logs you out on all devices. Log in with it and change it under **Settings →
Your account**.

## 13. If something doesn't work

| Problem                               | What usually helps                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `port is already allocated`           | Port 3313 is taken. Set e.g. `CONBERT_PORT=3320` in `.env`.                                       |
| Page doesn't load from another device | Check the IP address, open the port in the server's firewall.                                     |
| Can't find the setup code             | `docker compose logs conbert \| grep -A3 "not set up"`                                            |
| “On this device” doesn't work         | Open it via `https://…` or `http://localhost:3313` (see section 6).                               |
| Videos stop with a “memory” error     | Increase `CONBERT_MEMORY_LIMIT` or set `CONBERT_JOB_CONCURRENCY=1`.                               |
| Downloads from Instagram & co. fail   | Update the tools under **Settings → Download**; add cookies if needed ([cookies.md](cookies.md)). |
| Stored passwords stop working         | `CONBERT_SECRET` was changed – restore the old value or enter the passwords again.                |

You find more help in Conbert itself: click the **?** at the top right.
