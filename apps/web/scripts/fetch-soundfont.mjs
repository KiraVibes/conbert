// Downloads the GeneralUser GS soundfont (S. Christian Collins, free license,
// see THIRD_PARTY_LICENSES.md) once into public/soundfonts, so Conbert serves
// it itself – no download from third parties at runtime. Pinned to a commit
// and verified by checksum. Runs before `vite` and `vite build`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.0.3';
const COMMIT = '684543d5e5efaef08d02be50dcda8d552478fa60';
const URL_ = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${COMMIT}/GeneralUser-GS.sf2`;
const SHA256 = '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../public/soundfonts');
const file = path.join(dir, 'GeneralUser-GS.sf2');
// Set in Docker builds: a missing soundfont is an error there, not a warning.
const required = process.env.CONBERT_REQUIRE_SOUNDFONT === '1';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

if (existsSync(file) && sha256(readFileSync(file)) === SHA256) {
  process.exit(0);
}

try {
  console.warn(`fetch-soundfont: downloading GeneralUser GS ${VERSION} (~32 MB) …`);
  const response = await fetch(URL_);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== SHA256) throw new Error(`checksum mismatch (${actual})`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${file}.part`, data);
  renameSync(`${file}.part`, file);
  console.warn('fetch-soundfont: done → public/soundfonts/GeneralUser-GS.sf2');
} catch (error) {
  const message = `fetch-soundfont: could not download the soundfont (${error.message}). MIDI conversion in the browser won't work until it is available.`;
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}
