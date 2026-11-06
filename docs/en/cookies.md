# Exporting cookies (for the downloader)

Some content is only visible when you are logged in: Instagram stories,
private profiles, age-restricted YouTube videos, many Reddit posts. So that
Conbert can download them, you give it **your login as cookies** – you never
type your password into Conbert.

## What are cookies?

Cookies are small notes a website leaves in your browser. On your next visit
it recognises them: “You are already logged in.” If you export these notes as
a file (`cookies.txt`), Conbert can use them to act as if you were logged in.

> **Important:** Anyone who has your cookies can log in as you – treat the
> file like a password. Conbert stores it encrypted and never shows it again.
> Delete the file from your computer after uploading it.

## Step by step

1. **Install an extension:** “Get cookies.txt LOCALLY”
   - Chrome, Edge, Brave: search the Chrome Web Store
   - Firefox: search addons.mozilla.org

   It works only on your device and sends nothing anywhere. (Other
   extensions work too, as long as they save the **Netscape format** – the
   file then starts with `# Netscape HTTP Cookie File`.)

2. **Log in on the site**, e.g. on `instagram.com` – just as usual with your
   account.

3. **Export:** Click the extension's icon at the top right, then
   **“Export”**. A file such as `instagram.com_cookies.txt` is saved.

4. **Upload it to Conbert:** Settings → **Download** → click **“Upload
   cookies.txt”** next to the matching platform.

5. **Delete the file** – it is now stored encrypted in Conbert.

## Good to know

- **Every site needs its own file.** You export Instagram cookies on
  instagram.com, Reddit cookies on reddit.com and so on.
- **When do I need them?** Instagram and Reddit hardly work without cookies
  any more. YouTube, TikTok & co. usually work without them – except for
  private or age-restricted content.
- **Logging out makes them invalid.** If you log out on the site (or change
  your password), the cookies stop working. Simply export them again and
  upload them with **“Replace”**.
- **Protect your account.** If you download a lot at once, a site may block
  your account for a while. That's why you can set a **pause between
  requests** under Settings → Download. For many downloads, better use a
  second account.
- **Pixiv** is connected directly in Conbert with “Connect Pixiv” – you don't
  need a cookies.txt for it.
- **DeviantArt** needs no cookies.txt – cookies would change nothing there.
  Without setup, Conbert only loads public works, and big galleries take long,
  because every gallery-dl user shares the same DeviantArt access. Better: set
  up your own access once under Settings → Download → **“DeviantArt access”**
  (about 5 minutes, with a guide). If you also log in to DeviantArt there,
  mature and private works come too.

## If it doesn't work

| Problem                                 | What usually helps                                                          |
| --------------------------------------- | --------------------------------------------------------------------------- |
| “This needs a login”                    | Upload cookies for exactly this site (see above).                           |
| Still “This needs a login” with cookies | Export again while you are logged in on the site and upload with “Replace”. |
| The file is not accepted                | It has to be a **cookies.txt** in Netscape format, not JSON.                |
| Suddenly all downloads fail             | Settings → Download → **“Update now”** (the sites change often).            |
