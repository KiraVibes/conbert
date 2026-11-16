// Writes the list of workshop tools into docs/werkzeuge.md (German) and
// docs/en/tools.md (English), straight from the app's own texts, so the list
// never drifts from the app. Run with: pnpm docs:tools
/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSHOP_GROUPS, WORKSHOP_TRICKS } from '../packages/core/src/workshop/tricks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- tools:start -->';
const END = '<!-- tools:end -->';

const FILES = {
  de: { file: 'docs/werkzeuge.md', tool: 'Werkzeug', does: 'Was es macht' },
  en: { file: 'docs/en/tools.md', tool: 'Tool', does: 'What it does' },
};

/** Table cells must stay on one line and must not contain a bare pipe. */
const cell = (text) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

function render(lang) {
  const texts = JSON.parse(
    readFileSync(path.join(root, `packages/i18n/src/locales/${lang}.json`), 'utf8'),
  ).workshop;
  const { tool, does } = FILES[lang];
  const parts = [];
  for (const group of WORKSHOP_GROUPS) {
    const g = texts.groups[group];
    const tricks = WORKSHOP_TRICKS.filter((t) => t.group === group);
    parts.push(
      `### ${g.title} (${tricks.length})`,
      '',
      g.intro,
      '',
      `| ${tool} | ${does} |`,
      '| --- | --- |',
    );
    for (const { id } of tricks) {
      const t = texts.tricks[id];
      if (!t?.title || !t.teaser)
        throw new Error(`workshop.tricks.${id} has no title or teaser (${lang})`);
      parts.push(`| **${cell(t.title)}** | ${cell(t.teaser)} |`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

for (const lang of Object.keys(FILES)) {
  const file = path.join(root, FILES[lang].file);
  const doc = readFileSync(file, 'utf8');
  const from = doc.indexOf(START);
  const to = doc.indexOf(END);
  if (from < 0 || to < from)
    throw new Error(`${FILES[lang].file}: markers ${START} / ${END} missing`);
  const next = `${doc.slice(0, from + START.length)}\n\n${render(lang)}\n${doc.slice(to)}`;
  writeFileSync(file, next);
  process.stdout.write(`${FILES[lang].file}: ${WORKSHOP_TRICKS.length} tools\n`);
}
