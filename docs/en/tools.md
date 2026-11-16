# What Conbert can do – all areas and tools

An overview of every part of Conbert. Each option inside the app has its own
ⓘ explanation; this page is for getting the big picture.

## Areas of the app

| Area                  | What it does                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Convert**           | Drop in files and pick a target format – on your device or on the server. “What do you need the file for?” picks format and settings for you (WhatsApp, email, printing …). |
| **Compress**          | Make files smaller – usually in the same format, e.g. so they fit into an email or take up less space. Levels or a target size in MB.                                       |
| **AI tools**          | Speech to text and subtitles (Whisper), remove picture backgrounds, upscale pictures. Run on the server; models are downloaded when first used.                             |
| **Archive**           | Everything you converted or compressed, ready to download again. Stays in your browser only, never on the server.                                                           |
| **PDF**               | Merge PDFs, split them or tidy them up: sort, turn and delete pages. Photos become pages too. Everything happens on your device.                                            |
| **Download**          | Paste a link from YouTube, TikTok, Instagram, X, Pixiv, 4chan and more. Conbert shows first what it finds; the files land in your list.                                     |
| **Booru**             | Download pictures from Safebooru, Gelbooru, Konachan & co. – by link or as a tag search, with a block list and rating filter.                                               |
| **Subscriptions**     | New posts of profiles, channels or tag searches are fetched automatically.                                                                                                  |
| **Swipe**             | Sort your downloads like on Tinder: left to delete, right to keep, up into your favourites. Finds similar pictures, too.                                                    |
| **Workflows**         | Chains like “convert to WebP → make smaller → save to the NAS” that run on the server by themselves, even with the browser closed.                                          |
| **Workshop**          | Playful but useful file tricks with an explanation of how they work – all tools are listed below. Everything runs on your device.                                           |
| **Storage locations** | Save to and open from NAS/SMB shares, SFTP, FTP, WebDAV/Nextcloud, S3 and mounted folders ([guide](storage.md)).                                                            |
| **API & CLI**         | Access keys for scripts, Home Assistant, n8n and the small `conbert` command line tool ([guide](api.md)).                                                                   |
| **Administration**    | Accounts, groups and permissions, sign-in through LDAP or a reverse proxy ([guide](ldap.md)).                                                                               |

## The FileWizard workshop

All workshop tools run in your browser – your files don't leave your device.
In the app, every tool has a “How does it work?” explanation.

<!-- tools:start -->

### File X-ray (7)

Look inside a file: what it really is, how it is built and whether it is unchanged.

| Tool                          | What it does                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **What is this file really?** | The extension can lie, the first bytes can't. Hocus pocus – disguise blown!                              |
| **Hex view**                  | See every single byte – explained in colour, even for huge files.                                        |
| **Checksums**                 | A fingerprint for your file: did the download arrive intact?                                             |
| **File entropy**              | How “random” are the bytes? Shows where pictures, text and encrypted data sit.                           |
| **File map**                  | Any file as a colourful picture of its bytes: text, zeros and packed data show up as areas of their own. |
| **Why so big?**               | Takes a file apart and shows what eats the space – with tips and buttons to make it smaller.             |
| **Compare**                   | Put two files side by side and see exactly what is different.                                            |

### File forensics (15)

Read traces like an investigator: what a file gives away about where it came from, how it was edited and its history.

| Tool                    | What it does                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Forgery detector**    | Was something retouched in here? Error level analysis makes edits visible.                                              |
| **Preview checker**     | Does the hidden preview inside a photo show the same as the photo? It often gives away the original before cropping.    |
| **Cropped?**            | Does a cropped screenshot still hold the rest of the original? Conbert brings it back.                                  |
| **JPG origin**          | Camera, photo editor or messenger? A photo's compression tables give away who saved it last.                            |
| **Copied areas**        | Was part of the picture copied to hide or double something? Conbert finds it.                                           |
| **Forensics magnifier** | Filters that make edits visible: picture noise, edges and brightness bands.                                             |
| **Real redaction?**     | Is the text still there under a PDF's black bars? Conbert finds it.                                                     |
| **Earlier versions**    | Many PDFs carry their old versions inside. Conbert takes them out again.                                                |
| **Danger check**        | Can I open this file safely? Conbert checks for disguised programs, macros, PDF scripts and archive tricks.             |
| **Program inspector**   | What's inside this .exe? Build date, signature, packer and everything the program is allowed to do.                     |
| **Text finder**         | Readable text in any file – web addresses, e-mails, IP addresses, file paths and crypto addresses highlighted.          |
| **Timeline**            | Every date and time in a file, in order – and hints where they don't fit together.                                      |
| **Cut detector**        | Was this recording cut? Jumps in the background noise, clicks and the mains hum give it away.                           |
| **Hidden text in PDFs** | Finds text that people can't see but machines read: white on white, tiny or off the page.                               |
| **Email check**         | Is this email real? Shows where it really comes from, whether the sender is verified and where the links actually lead. |

### Hide & reveal (10)

Hide messages and files invisibly – and find hidden things again.

| Tool                           | What it does                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Detective scan**             | Searches any file for hidden things – and gets them out. Elementary, my dear Watson!                          |
| **Steganography**              | Hide a secret message invisibly in the pixels of a picture – and conjure it up again.                         |
| **Audio steganography**        | Hide a secret message or file inaudibly in a piece of music – and get it back out.                            |
| **Archive in a picture**       | Hide your secret files as a stowaway in a harmless picture.                                                   |
| **Polyglot files**             | Two files in one: a picture or PDF and a ZIP archive merge seamlessly.                                        |
| **Picture in the spectrogram** | Turn a picture into sounds that show it again in a spectrogram – and look at any sound file as a spectrogram. |
| **Secret message in metadata** | Write a message into the comment fields of a photo, PDF or song – and read such fields.                       |
| **Secret writing**             | Caesar, Vigenère, Morse, Braille & co. – write, play and crack them like a detective.                         |
| **Invisible text**             | Tuck a message invisibly into an ordinary sentence – and track down hidden characters in copied text.         |
| **Data in a video**            | Pack any file into a video of black and white squares – and get it out again.                                 |

### Protect (5)

Encrypt files so that only the right people can open them.

| Tool                                   | What it does                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Encrypt for …**                      | A lock only chosen people have the key to. Open sesame – but only for you!                                                   |
| **What does my file give away?**       | Where a photo was taken, with which camera, who wrote the document – check before you share it.                              |
| **What does your document give away?** | Author names, company, template path, comments, deleted text: what Word, Excel & co. secretly send along – and a clean copy. |
| **Treasure map**                       | Tear a secret into parts – it only reappears when enough of them come together.                                              |
| **Password package**                   | Pack files into one single file that only opens with a password – in any browser, no program needed.                         |

### Fun with pictures, audio & video (19)

Effects and toys for pictures, sounds and videos.

| Tool                              | What it does                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **ASCII art**                     | Your picture drawn with nothing but letters and symbols – as text, web page or image.                                                      |
| **Pixel art**                     | Turn a photo into a picture like on the Game Boy, NES or C64.                                                                              |
| **Emoji mosaic**                  | Rebuild your photo from emojis – as a picture or as text to send.                                                                          |
| **Ringtone maker**                | Cut your favourite part out of a song – with a soft start and end.                                                                         |
| **Audio to video**                | Turn a song or podcast into a video with a waveform and cover – for YouTube, Instagram & TikTok.                                           |
| **Preview prank**                 | A photo that looks completely different in the small preview than when you open it. The cat turns into a cucumber!                         |
| **Listen to a file**              | What does a JPG, a ZIP or an .exe sound like? Every byte becomes a sound.                                                                  |
| **Morse code**                    | Turn text into dots and dashes – as sound, as a flashing light and back, through the microphone. Or just say something and it gets morsed. |
| **Picture as radio sound (SSTV)** | Turn a picture into a sound like radio amateurs and the ISS send – and turn such sounds back into pictures.                                |
| **Sticker maker**                 | A picture as a WhatsApp or Telegram sticker: cut out, with a white edge, exactly 512 × 512.                                                |
| **Glitch art**                    | Broken, but beautiful: glitches like in a damaged file – on purpose.                                                                       |
| **Deep fry & JPEG death**         | Meme look with screaming colours – and a picture saved so often that it falls apart.                                                       |
| **QR codes**                      | Make QR codes for links, WLAN access or contacts – with a logo if you like – and read codes from pictures.                                 |
| **Icon & favicon generator**      | One picture in, every icon out: favicon.ico, app icons for iPhone and Android, a macOS icon and the manifest.                              |
| **Lithophane & relief**           | A photo as a 3D print that shows the picture when held against the light – or a logo as a raised relief.                                   |
| **Handwriting as a font**         | Print a sheet, fill it in, take a photo – and your handwriting becomes a real font for Word & co.                                          |
| **Letter in handwriting**         | Write a letter in your own handwriting font – with small irregularities so it looks real.                                                  |
| **Sound poster**                  | A voice message, a song or a first “mama” as a beautiful waveform poster to print.                                                         |
| **Magic Eye picture**             | A picture of colourful dots with a 3D shape hidden in it – visible only with the right look.                                               |

### File tools (12)

Little helpers: split, encode and repair files.

| Tool                     | What it does                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **File repair**          | Broken checksums, cut-off pictures, wrong extension – Reparo!                                                                 |
| **Encode & decode**      | Base64, hex, URL encoding and data URIs – for text and whole files, both ways.                                                |
| **File splitter**        | Cut a big file into parts – and put parts back together.                                                                      |
| **Test files**           | Make files of exactly the size you need – or a test picture, test tone, test PDF and test video.                              |
| **Get pictures out**     | Pull every photo and graphic out of Word, PowerPoint, PDF, EPUB & co. – in original quality.                                  |
| **Document scanner**     | Take photos of letters, receipts or forms – Conbert turns them into straight, clean pages and a PDF.                          |
| **Paper backup**         | A small file as printable QR codes – passwords, keys and important notes survive any disk crash this way.                     |
| **Contact sheet**        | A video as a single picture: evenly spread scenes with times – or as a sprite sheet for games.                                |
| **Colour palette**       | A picture's main colours as colour codes – to copy, or as a palette for design programs.                                      |
| **Fix the camera clock** | Wrong capture time? Shift the date of many photos and videos at once – e.g. when the camera clock was an hour off on holiday. |
| **Comic maker**          | A folder of pictures becomes a comic (CBZ) or e-book (EPUB) – for comic readers, Kobo, Kindle apps & co.                      |
| **Batch rename**         | Rename many files at once – e.g. “2024-07-14_Pixel-8_01.jpg” with the date taken and camera from the EXIF data.               |

<!-- tools:end -->
