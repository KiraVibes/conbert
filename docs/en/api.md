# Using Conbert from scripts and other programs (API)

Conbert isn't only for the browser. Through the **API** (an interface for
programs), scripts, **Home Assistant**, **n8n**, **iPhone Shortcuts** or the
**command line** can convert and compress files and download links – without
any clicking.

This guide explains everything from the start. All you need is:

- your running Conbert server,
- an **API token** (a kind of password just for programs),
- a program that can send web requests – e.g. `curl`, which already comes
  with Windows 10/11, macOS and Linux.

---

## Contents

1. [The essentials in one minute](#1-the-essentials-in-one-minute)
2. [Creating a token](#2-creating-a-token)
3. [Your server's address](#3-your-servers-address)
4. [Converting a file – the easiest way](#4-converting-a-file--the-easiest-way)
5. [Passing settings (options)](#5-passing-settings-options)
6. [Special tasks: compress, OCR, trim, AI, subtitles](#6-special-tasks)
7. [Step by step: upload, job, result](#7-step-by-step-upload-job-result)
8. [Downloading links (Instagram, YouTube …)](#8-downloading-links)
9. [The `conbert` command line](#9-the-conbert-command-line)
10. [Examples: Home Assistant, n8n, iPhone, Python, Windows](#10-examples)
11. [Understanding error messages](#11-understanding-error-messages)
12. [Limits and security](#12-limits-and-security)
13. [All endpoints (OpenAPI)](#13-all-endpoints-openapi)

---

## 1. The essentials in one minute

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     --data-binary @photo.heic \
     "http://192.168.1.10:3313/api/convert?to=jpg&name=photo.heic" \
     -o photo.jpg
```

- `Authorization: Bearer YOUR_TOKEN` – tells Conbert who you are.
- `--data-binary @photo.heic` – sends the file as it is.
- `to=jpg` – the target format.
- `name=photo.heic` – the original name (used to name the result).
- `-o photo.jpg` – saves the result.

Done. Everything else is a variation of this.

---

## 2. Creating a token

1. Open Conbert in your browser and log in.
2. Go to **Settings → API access**.
3. Under **“What for?”** enter a name, e.g. `Home Assistant` or `My laptop`.
   That way you'll know later which token is for what.
4. Choose how long it should be valid (30 days, 90 days, 1 year or no
   expiry).
5. Click **“Create token”**.
6. **Copy the token right away** – it starts with `cbt_` and is shown **only
   this one time**. Conbert itself only stores a “fingerprint” of it and
   can't show it to you again.

Lost it? No problem: delete the old token, create a new one.

**What a token may do:** everything you may do in Conbert – convert,
compress and download files, use storage locations.
**What a token may not do:** manage tokens, users, passwords and the key
vault. So if a token falls into the wrong hands, nobody can take over your
account with it. Still, delete it right away when you no longer need it.

The list shows for every token when it was created and **last used**, and
how long it is still valid.

---

## 3. Your server's address

It's the same address you type into your browser, e.g.:

| Situation                                    | Address                                       |
| -------------------------------------------- | --------------------------------------------- |
| Program runs on the same computer as Conbert | `http://localhost:3313`                       |
| In your home network                         | `http://192.168.1.10:3313` (your server's IP) |
| Through a reverse proxy with HTTPS           | `https://conbert.example.com`                 |

All examples below use `http://192.168.1.10:3313` – replace it with your
address.

> **Tip:** If you access it over the internet, always use **HTTPS**.
> Otherwise the token is sent unencrypted.

**Quick test** whether everything is right:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://192.168.1.10:3313/api/engines
```

If a long list comes back, everything is fine. If you get `INVALID_TOKEN`,
the token was copied wrongly, has expired or was deleted.

---

## 4. Converting a file – the easiest way

**`POST /api/convert`** takes a file, converts it and sends the result
straight back – all in one request.

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     --data-binary @holiday.mov \
     "http://192.168.1.10:3313/api/convert?to=mp4&name=holiday.mov" \
     -o holiday.mp4
```

### The parameters in the address

| Parameter | Required?   | Meaning                                                                                                                 | Example                  |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `to`      | yes         | Target format (file extension without the dot)                                                                          | `to=webp`                |
| `name`    | recommended | Original file name. The result's name is built from it; for text formats (CSV, SVG …) the extension helps to detect it. | `name=report.docx`       |
| `mode`    | no          | `convert` (default), `compress` (make smaller) or `ocr` (make a PDF searchable)                                         | `mode=compress`          |
| `options` | no          | Settings as JSON, see [section 5](#5-passing-settings-options)                                                          | `options={"quality":80}` |
| `wait`    | no          | How many seconds Conbert waits for the result (0–1800, default 600)                                                     | `wait=60`                |

### What comes back

| Response                 | Meaning                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **200** + file           | Done. The name is in the `Content-Disposition` header, the job ID in `X-Conbert-Job`.                                                      |
| **202** + `{ "job": … }` | Takes longer than `wait`. The job keeps running – check it with `GET /api/jobs/{id}` (see [section 7](#7-step-by-step-upload-job-result)). |
| **400**                  | Empty file or wrong parameters (e.g. `options` isn't valid JSON).                                                                          |
| **413**                  | File larger than allowed (default 2 GB).                                                                                                   |
| **422**                  | No way into this format, or the conversion failed. The response says why.                                                                  |

Which format can become what is listed by `GET /api/engines` – or quickly
with the command line: `conbert formats heic` (see
[section 9](#9-the-conbert-command-line)).

> **Important:** Conversion through the API **always runs on the server**.
> Formats that Conbert can only handle in the browser don't work via the API.

---

## 5. Passing settings (options)

Everything you can set in the web interface also works through the API. The
settings go into the `options` parameter as JSON.

**Image with quality 70:**

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" --data-binary @photo.png \
     "http://192.168.1.10:3313/api/convert?to=jpg&name=photo.png&options=%7B%22quality%22%3A70%7D" \
     -o photo.jpg
```

`%7B%22quality%22%3A70%7D` is `{"quality":70}`, “URL-encoded” (so the special
characters fit into the address). It's more convenient with the
[command line](#9-the-conbert-command-line): `--option quality=70`.

### Common settings

| Key             | For                 | Values                                              | Meaning                                    |
| --------------- | ------------------- | --------------------------------------------------- | ------------------------------------------ |
| `quality`       | JPG, WebP, AVIF     | 1–100 (default 80)                                  | Image quality – higher = nicer, but larger |
| `stripMetadata` | Images              | `true`/`false`                                      | Remove camera data and GPS location        |
| `videoQuality`  | Videos              | `high`, `balanced`, `small`                         | Video quality                              |
| `resolution`    | Videos, GIF         | `keep`, `2160`, `1440`, `1080`, `720`, `480`, `360` | at most this many pixels high              |
| `fps`           | Videos, GIF         | `keep`, `60`, `30`, `24`, `15`, `10`                | Frames per second                          |
| `removeAudio`   | Videos              | `true`                                              | Remove the sound                           |
| `audioQuality`  | MP3, OGG, Opus, M4A | `high`, `balanced`, `small`                         | Sound quality                              |
| `audioBitrate`  | Music, videos       | `auto`, `64` … `320`                                | Fixed bitrate in kbit/s                    |
| `channels`      | Music               | `keep`, `stereo`, `mono`                            | Audio channels                             |

**All settings of an engine** – with default and allowed values – are listed
by `GET /api/engines`. With the `jq` tool:

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://192.168.1.10:3313/api/engines \
  | jq '.engines[] | {id, options: [.options[] | {key, default, values: [.choices[]?.value]}]}'
```

Conbert ignores unknown or unsuitable settings.

---

## 6. Special tasks

### Compressing (same format, smaller file)

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" --data-binary @large.jpg \
     "http://192.168.1.10:3313/api/convert?to=jpg&mode=compress&name=large.jpg" -o small.jpg
```

You control the strength through the settings, e.g. `{"quality":60}`.

### Making a scanned PDF searchable (OCR)

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" --data-binary @scan.pdf \
     "http://192.168.1.10:3313/api/convert?to=pdf&mode=ocr&name=scan.pdf" -o scan-text.pdf
```

Settings: `ocrLanguage` (`deu+eng`, `deu`, `eng`), `ocrRotate`
(`true`/`false`), `ocrDeskew` (`true` = straighten crooked pages), `ocrMode`
(`skip`, `redo`, `force`). OCR can take a few minutes for many pages – set
`wait` higher then.

### Only part of a video or song

`trimStart` and `trimEnd` in seconds; `trimFast: true` cuts without
re-encoding (only with the same format, start is not exact):

```text
options={"trimStart":12.5,"trimEnd":30}
```

A clip also works into the **same format** (`to=mp4` from an MP4) or as a
**GIF/WebP animation** (`to=gif`, `to=webp`).

### Removing the background, upscaling (AI)

```text
options={"removeBackground":true}          → best with to=png
options={"upscale":2}                       → twice as large (or 4)
options={"removeBackground":true,"upscale":2}
```

The first time, the server downloads the AI model (once, up to ~180 MB) –
the first request then takes longer.

### Speech to text or subtitles (Whisper)

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" --data-binary @talk.mp4 \
     "http://192.168.1.10:3313/api/convert?to=srt&name=talk.mp4&wait=1800" -o talk.srt
```

Targets: `srt`, `vtt` (subtitles) or `txt` (plain text). Settings:
`speechLanguage` (`auto`, `de`, `en`, …), `translateToEnglish` (`true`).
Long recordings take time – use `wait=1800` or the way from
[section 7](#7-step-by-step-upload-job-result).

---

## 7. Step by step: upload, job, result

For long jobs, large files, or when you want to show the progress. Three
steps:

**1. Upload the file** – `POST /api/files`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" --data-binary @movie.mkv \
     "http://192.168.1.10:3313/api/files?name=movie.mkv"
```

Response: `{"file":{"id":"3f2b…","name":"movie.mkv","ext":"mkv","size":…}}`

**2. Start the job** – `POST /api/jobs` with JSON:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"fileId":"3f2b…","outputExt":"mp4","mode":"convert","options":{"videoQuality":"small"}}' \
     http://192.168.1.10:3313/api/jobs
```

Response: `{"job":{"id":"9a1c…","status":"queued","progress":0,…}}`

**3. Ask until it's done** – `GET /api/jobs/{id}`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://192.168.1.10:3313/api/jobs/9a1c…
```

| `status`    | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `queued`    | waiting for its turn                                           |
| `running`   | running – `progress` (0–100) and `stage` show what's happening |
| `done`      | finished – `resultName`, `resultSize`                          |
| `error`     | failed – `error.messageKey` and `error.details`                |
| `cancelled` | cancelled                                                      |

Don't ask more often than about once per second.

**4. Fetch the result** – `GET /api/jobs/{id}/result`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" -OJ http://192.168.1.10:3313/api/jobs/9a1c…/result
```

(`-OJ` saves under the name Conbert suggests.)

**Cancel:** `DELETE /api/jobs/{id}`.

> Conbert deletes results and uploaded files again after a while (default:
> 60 minutes after completion, adjustable with `CONBERT_CLEANUP_MINUTES`).
> So fetch them soon.

---

## 8. Downloading links

Like the “Download” page – just from a program.

**What's behind a link?** – `POST /api/downloader/probe`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
     http://192.168.1.10:3313/api/downloader/probe
```

Response: platform, title, whether it's a video/playlist/profile, count,
whether a login would be needed …

**Download** – `POST /api/downloader/jobs`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://www.instagram.com/reel/ABC123/","targetIds":["ID-OF-YOUR-STORAGE-LOCATION"],"toList":false}' \
     http://192.168.1.10:3313/api/downloader/jobs
```

| Field                     | Meaning                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `url`                     | the link                                                          |
| `quality`                 | `best` (default), `1080`, `720`, `480` or `audio` (sound only)    |
| `parts`                   | for Instagram profiles: `posts`, `reels`, `stories`, `highlights` |
| `limit`                   | at most this many posts (default 50, at most 50000)               |
| `dateAfter`, `dateBefore` | only from this period (`2026-01-31`)                              |
| `targetIds`               | storage locations the files should end up on                      |
| `toList`                  | `true` = files stay on the server for you to fetch (default)      |
| `skipKnown`               | skip what was downloaded before (default `true`)                  |

You find the **ID of a storage location** with `GET /api/targets` (field
`id`). With `toList: false` you have to give at least one storage location.

**Check the status:** `GET /api/downloader/jobs/{id}` – the finished files
are listed under `files` (with `fileId`). You fetch a file with
`GET /api/files/{fileId}/content`.

---

## 9. The `conbert` command line

A small program that does the uploading, waiting and saving for you. It
needs **Node.js 20 or newer** (free from nodejs.org).

**Download** – your server offers it itself:

```bash
curl -O http://192.168.1.10:3313/cli/conbert.mjs
```

**Log in once** (stores address and token):

```bash
node conbert.mjs login http://192.168.1.10:3313 YOUR_TOKEN
```

The details are then stored in `~/.config/conbert/config.json` (Windows:
`%APPDATA%\conbert\config.json`), readable only by you.

**Convert:**

```bash
node conbert.mjs convert photo.heic --to jpg
node conbert.mjs convert *.wav --to mp3 --option audioQuality=high --out done/
node conbert.mjs convert scan.pdf --to pdf --mode ocr
node conbert.mjs convert large.jpg --to jpg --mode compress --option quality=60
```

| Parameter                        | Meaning                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `--to <format>`                  | Target format (required)                                               |
| `--out <folder>`                 | Put the results there (default: next to the original file)             |
| `--mode compress` / `--mode ocr` | compress / make a PDF searchable                                       |
| `--option key=value`             | A setting (can be repeated); numbers and `true`/`false` are recognised |

**What can a format become?**

```bash
node conbert.mjs formats heic
```

**Without logging in**, e.g. in scripts or Docker: set the environment
variables `CONBERT_URL` and `CONBERT_TOKEN`.

**Exit code:** `0` = everything worked, `1` = at least one file failed (or
not logged in), `2` = wrong usage. Handy for scripts:
`node conbert.mjs convert … || echo "Didn't work"`.

The messages are in German if your system is set to German (`LANG=de…`),
otherwise in English.

So you don't always have to type `node conbert.mjs` (Linux/macOS):

```bash
chmod +x conbert.mjs && sudo mv conbert.mjs /usr/local/bin/conbert
conbert convert photo.heic --to jpg
```

---

## 10. Examples

### Bash: all iPhone photos in a folder to JPG

```bash
export CONBERT_URL=http://192.168.1.10:3313
export CONBERT_TOKEN=YOUR_TOKEN
node conbert.mjs convert ~/Pictures/*.HEIC --to jpg --out ~/Pictures/jpg
```

### Windows PowerShell

In PowerShell, `curl` is a different command – use `curl.exe`:

```powershell
curl.exe -H "Authorization: Bearer YOUR_TOKEN" --data-binary "@photo.heic" `
  "http://192.168.1.10:3313/api/convert?to=jpg&name=photo.heic" -o photo.jpg
```

Or with built-in tools:

```powershell
Invoke-WebRequest -Method Post -Headers @{ Authorization = "Bearer YOUR_TOKEN" } `
  -InFile photo.heic -Uri "http://192.168.1.10:3313/api/convert?to=jpg&name=photo.heic" `
  -OutFile photo.jpg
```

### Python

```python
import requests

SERVER = "http://192.168.1.10:3313"
HEADERS = {"Authorization": "Bearer YOUR_TOKEN"}

with open("photo.heic", "rb") as f:
    r = requests.post(f"{SERVER}/api/convert",
                      params={"to": "jpg", "name": "photo.heic", "options": '{"quality":85}'},
                      headers=HEADERS, data=f, timeout=900)
if r.status_code == 200:
    open("photo.jpg", "wb").write(r.content)
else:
    print("Error:", r.json()["error"])
```

### Home Assistant

**Download a link (e.g. from a notification) to the NAS.** In
`configuration.yaml`:

```yaml
rest_command:
  conbert_download:
    url: 'http://192.168.1.10:3313/api/downloader/jobs'
    method: POST
    headers:
      Authorization: !secret conbert_token # in secrets.yaml: "Bearer cbt_…"
      Content-Type: application/json
    payload: '{"url": "{{ url }}", "targetIds": ["ID-OF-YOUR-STORAGE-LOCATION"], "toList": false}'
```

Call it in an automation: service `rest_command.conbert_download` with
`url: "https://…"`.

**Converting a file** (e.g. a camera snapshot) works with `shell_command`
and curl:

```yaml
shell_command:
  conbert_to_webp: >-
    curl -s -H "Authorization: Bearer YOUR_TOKEN" --data-binary @/config/www/snapshot.jpg
    "http://192.168.1.10:3313/api/convert?to=webp&name=snapshot.jpg" -o /config/www/snapshot.webp
```

### n8n

1. Add an **HTTP Request** node.
2. **Method:** `POST`, **URL:** `http://192.168.1.10:3313/api/convert?to=jpg&name={{ $binary.data.fileName }}`.
3. **Authentication:** “Generic Credential Type” → “Header Auth” with name
   `Authorization` and value `Bearer YOUR_TOKEN`.
4. **Send Body:** on, **Body Content Type:** “n8n Binary File”, field `data`.
5. **Options → Response → Response Format:** “File”.

Tip: In n8n (and Postman) you can also import the OpenAPI description – see
[section 13](#13-all-endpoints-openapi).

### iPhone / iPad: shortcut “To JPG with Conbert”

1. New shortcut; in its settings switch on “Show in Share Sheet”, types
   “Images” and “Files”.
2. Action **“Get Contents of URL”**:
   - URL: `https://conbert.example.com/api/convert?to=jpg&name=image.heic`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_TOKEN`
   - Request Body: **File** → “Shortcut Input”
3. Action **“Save to Photo Album”** (or “Save File”).

The iPhone needs an address it can reach – the IP in your home network, an
HTTPS address through your reverse proxy when you're out.

> On your phone you can also share links from Instagram, TikTok & co.
> without the API: install Conbert as an app (“Add to Home Screen”), then
> **Share → Conbert** – the link lands directly on the “Download” page. This
> needs HTTPS.

---

## 11. Understanding error messages

Every error response looks like this:

```json
{
  "error": {
    "code": "NO_SERVER_ROUTE",
    "messageKey": "errors.noServerRoute",
    "details": "png → xyz"
  }
}
```

- `code` – short and fixed, good for checking in scripts.
- `messageKey` – the key of the help text in Conbert (the interface shows
  the understandable explanation under this name).
- `details` – technical details, if any.

| HTTP | `code`              | What's going on?                                                                                 | What to do?                                                  |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 401  | `UNAUTHORIZED`      | No token sent                                                                                    | Add the `Authorization: Bearer …` header                     |
| 401  | `INVALID_TOKEN`     | Token wrong, expired or deleted                                                                  | Create a new token                                           |
| 403  | `TOKEN_NOT_ALLOWED` | A token may not do this (manage tokens, users, passwords)                                        | Log in in the browser                                        |
| 400  | `BAD_REQUEST`       | Empty file or wrong parameters                                                                   | Check the call; `details` says what doesn't fit              |
| 413  | `FILE_TOO_LARGE`    | File larger than allowed                                                                         | The admin can raise `CONBERT_MAX_UPLOAD_MB`                  |
| 422  | `NO_SERVER_ROUTE`   | The server can't convert this format into the target                                             | Another target, or try “On this device” in the web interface |
| 422  | `CONVERSION_FAILED` | The conversion went wrong; `messageKey` says why (e.g. `errors.encrypted` = file has a password) | Read `details`, check the file                               |
| 410  | `RESULT_GONE`       | Result not ready yet or already deleted                                                          | Fetch it later/sooner                                        |
| 503  | `QUEUE_UNAVAILABLE` | The server's queue (Valkey/Redis) isn't running                                                  | Admin: check `docker compose ps`                             |
| 404  | `NOT_FOUND`         | Address or job doesn't exist                                                                     | Check address and ID                                         |

---

## 12. Limits and security

- **File size:** at most 2 GB per file (admin: `CONBERT_MAX_UPLOAD_MB`).
- **Storage quota:** The admin can set how much you may keep on the server
  at the same time. `GET /api/me/usage` returns your status (`usedBytes`,
  `quotaBytes` – `null` means no limit).
- **Retention:** Uploads and results are deleted after
  `CONBERT_CLEANUP_MINUTES` (default 60 minutes).
- **At the same time:** The server works on `CONBERT_JOB_CONCURRENCY` jobs at
  once (default 2); more wait in the queue.
- **Everyone sees only their own:** files, jobs and storage locations belong
  to the user who owns the token.
- **Tokens are like passwords:** keep them out of public scripts, Git and
  screenshots. In Home Assistant put them in `secrets.yaml`.
- Use **HTTPS** as soon as it goes over the internet.
- A token you no longer need: **delete it**. It stops working immediately.

---

**For admins – monitoring with Prometheus:** `GET /api/metrics` returns
metrics (jobs, disk space, usage per user, engine status) in Prometheus
format. Create a token as admin and enter it as bearer token in the
Prometheus configuration:

```yaml
scrape_configs:
  - job_name: conbert
    metrics_path: /api/metrics
    authorization: { type: Bearer, credentials: YOUR_ADMIN_TOKEN }
    static_configs: [{ targets: ['192.168.1.10:3313'] }]
```

## 13. All endpoints (OpenAPI)

The complete, machine-readable description of all endpoints mentioned here
is available at:

```text
http://192.168.1.10:3313/api/openapi.json
```

It is generated from the same rules Conbert uses to check every request, so
it is always up to date. You can import it into:

- **n8n** and **Postman** (Import → “OpenAPI”),
- the **Swagger Editor** (editor.swagger.io → File → Import URL), to read and
  try out everything clearly.

Your server also serves this guide itself: `/docs/en/api.md` (link in
**Settings → API access**). The developer overview (all endpoints, including
those of the web interface) is in the project under `docs/spec/api.md`.
