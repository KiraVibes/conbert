import { zipSync, type Zippable } from 'fflate';
import type { ByteReader } from './reader';
import { findZipEnd, readZipEntries, type ZipEntry } from './structure';
import { extractZipEntry, WorkshopError } from './zip-tools';

/**
 * "What does your document give away?" – reads what Word, Excel,
 * PowerPoint and LibreOffice files carry besides the visible text: author
 * names, the company, the template's path on the author's computer,
 * comments, tracked (also deleted) changes, hidden text, hidden sheets and
 * slides, speaker notes – and makes a cleaned copy.
 */

export type OfficeKind = 'word' | 'excel' | 'powerpoint' | 'odf';

export interface OfficeChange {
  type: 'ins' | 'del';
  author: string;
  date: string | null;
  text: string;
}

export interface OfficeSecrets {
  kind: OfficeKind;
  /** Every person named somewhere (author, editor, comments, changes). */
  people: string[];
  /** Document properties (creator, company, template, editing time …). */
  properties: { key: string; value: string }[];
  comments: { author: string; text: string }[];
  changes: OfficeChange[];
  hiddenText: string[];
  hiddenSheets: string[];
  hiddenSlides: number[];
  notes: { slide: number; text: string }[];
  /** Paths from the author's computer or network (template, links). */
  paths: string[];
  thumbnail: boolean;
  /** Editing sessions recorded in a Word file (rsid). */
  sessions: number;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/** The text of all <tag>…</tag> in a piece of XML. */
const textOf = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))]
    .map((m) => decodeXml(m[1] ?? ''))
    .join('');

const attr = (tag: string, name: string) =>
  decodeXml(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '');

interface Zip {
  entries: ZipEntry[];
  text(name: string): Promise<string>;
  names: string[];
}

async function openZip(reader: ByteReader): Promise<Zip> {
  const end = await findZipEnd(reader);
  if (!end) throw new WorkshopError('not-archive');
  const entries = await readZipEntries(reader, end);
  if (entries.some((e) => e.encrypted)) throw new WorkshopError('encrypted');
  return {
    entries,
    names: entries.map((e) => e.name),
    async text(name: string) {
      const e = entries.find((x) => x.name === name);
      if (!e || e.size > 64 * 1024 * 1024) return '';
      return new TextDecoder().decode(await extractZipEntry(reader, e));
    },
  };
}

function kindOf(names: readonly string[]): OfficeKind | null {
  if (names.includes('word/document.xml')) return 'word';
  if (names.includes('xl/workbook.xml')) return 'excel';
  if (names.includes('ppt/presentation.xml')) return 'powerpoint';
  if (names.includes('content.xml') && names.includes('meta.xml')) return 'odf';
  return null;
}

const PROPERTY_TAGS: [string, string][] = [
  ['dc:creator', 'creator'],
  ['cp:lastModifiedBy', 'lastModifiedBy'],
  ['dcterms:created', 'created'],
  ['dcterms:modified', 'modified'],
  ['cp:lastPrinted', 'lastPrinted'],
  ['cp:revision', 'revision'],
  ['dc:title', 'title'],
  ['dc:subject', 'subject'],
  ['cp:keywords', 'keywords'],
  ['dc:description', 'description'],
  ['Application', 'application'],
  ['Company', 'company'],
  ['Manager', 'manager'],
  ['Template', 'template'],
  ['TotalTime', 'totalTime'],
  ['HyperlinkBase', 'hyperlinkBase'],
  // LibreOffice (meta.xml)
  ['meta:initial-creator', 'creator'],
  ['meta:creation-date', 'created'],
  ['dc:date', 'modified'],
  ['meta:editing-cycles', 'revision'],
  ['meta:editing-duration', 'totalTime'],
  ['meta:generator', 'application'],
  ['meta:printed-by', 'printedBy'],
];

const PATH = /(?:[a-z]:\\|\\\\|file:\/\/\/?)[^"<>|*?\r\n]{3,}/gi;

export async function readOfficeSecrets(reader: ByteReader): Promise<OfficeSecrets> {
  const zip = await openZip(reader);
  const kind = kindOf(zip.names);
  if (!kind) throw new WorkshopError('broken', 'not an office document');
  const people = new Set<string>();
  const addPerson = (p: string) => {
    const name = p.trim();
    if (name) people.add(name);
  };
  const out: OfficeSecrets = {
    kind,
    people: [],
    properties: [],
    comments: [],
    changes: [],
    hiddenText: [],
    hiddenSheets: [],
    hiddenSlides: [],
    notes: [],
    paths: [],
    thumbnail: zip.names.some((n) => /^(docProps\/thumbnail\.|Thumbnails\/)/i.test(n)),
    sessions: 0,
  };

  const meta =
    kind === 'odf'
      ? await zip.text('meta.xml')
      : (await zip.text('docProps/core.xml')) + (await zip.text('docProps/app.xml'));
  for (const [tag, key] of PROPERTY_TAGS) {
    const value = textOf(meta, tag).trim();
    if (!value || out.properties.some((p) => p.key === key)) continue;
    out.properties.push({ key, value });
    if (key === 'creator' || key === 'lastModifiedBy' || key === 'manager' || key === 'printedBy')
      addPerson(value);
  }

  const paths = new Set<string>();
  const scanPaths = (xml: string) => {
    for (const m of xml.matchAll(PATH)) paths.add(decodeXml(m[0]));
  };
  for (const name of zip.names.filter((n) => n.endsWith('.rels'))) scanPaths(await zip.text(name));
  scanPaths(meta);

  if (kind === 'word') {
    const doc = await zip.text('word/document.xml');
    for (const m of doc.matchAll(/<w:(ins|del)\b([^>]*)>([\s\S]*?)<\/w:\1>/g)) {
      const type = m[1] as 'ins' | 'del';
      const author = attr(m[2] ?? '', 'w:author');
      addPerson(author);
      const text = textOf(m[3] ?? '', type === 'del' ? 'w:delText' : 'w:t');
      if (text.trim())
        out.changes.push({ type, author, date: attr(m[2] ?? '', 'w:date') || null, text });
    }
    for (const m of doc.matchAll(
      /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:vanish\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
    )) {
      const text = textOf(m[0], 'w:t');
      if (text.trim()) out.hiddenText.push(text);
    }
    const comments = await zip.text('word/comments.xml');
    for (const m of comments.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
      const author = attr(m[1] ?? '', 'w:author');
      addPerson(author);
      out.comments.push({ author, text: textOf(m[2] ?? '', 'w:t') });
    }
    for (const m of (await zip.text('word/people.xml')).matchAll(/w15:author="([^"]*)"/g))
      addPerson(decodeXml(m[1] ?? ''));
    out.sessions = (await zip.text('word/settings.xml')).match(/<w:rsid\b/g)?.length ?? 0;
  }

  if (kind === 'excel') {
    const book = await zip.text('xl/workbook.xml');
    for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
      if (/state="(hidden|veryHidden)"/.test(m[0])) out.hiddenSheets.push(attr(m[0], 'name'));
    }
    for (const name of zip.names.filter((n) =>
      /^xl\/(comments\d*|threadedComments\/threadedComment\d*)\.xml$/.test(n),
    )) {
      const xml = await zip.text(name);
      const authors = [...xml.matchAll(/<author>([^<]*)<\/author>/g)].map((a) =>
        decodeXml(a[1] ?? ''),
      );
      authors.forEach(addPerson);
      for (const c of xml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
        const id = Number(attr(c[1] ?? '', 'authorId'));
        out.comments.push({ author: authors[id] ?? '', text: textOf(c[2] ?? '', 't') });
      }
    }
    for (const m of (await zip.text('xl/persons/person.xml')).matchAll(/displayName="([^"]*)"/g))
      addPerson(decodeXml(m[1] ?? ''));
  }

  if (kind === 'powerpoint') {
    const slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    for (const name of slides) {
      const n = Number(/slide(\d+)\.xml$/.exec(name)?.[1]);
      if (/<p:sld\b[^>]*\sshow="0"/.test(await zip.text(name))) out.hiddenSlides.push(n);
    }
    for (const name of zip.names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))) {
      const text = textOf(await zip.text(name), 'a:t').trim();
      // The notes page repeats the slide number as text – skip bare numbers.
      if (text && !/^\d+$/.test(text))
        out.notes.push({ slide: Number(/(\d+)\.xml$/.exec(name)?.[1]), text });
    }
    const authors = await zip.text('ppt/commentAuthors.xml');
    for (const m of authors.matchAll(/name="([^"]*)"/g)) addPerson(decodeXml(m[1] ?? ''));
    for (const name of zip.names.filter((n) => /^ppt\/comments\/.*\.xml$/.test(n))) {
      for (const c of (await zip.text(name)).matchAll(/<p:text>([^<]*)<\/p:text>/g))
        out.comments.push({ author: '', text: decodeXml(c[1] ?? '') });
    }
    out.hiddenSlides.sort((a, b) => a - b);
    out.notes.sort((a, b) => a.slide - b.slide);
  }

  if (kind === 'odf') {
    const content = await zip.text('content.xml');
    for (const m of content.matchAll(/<office:annotation\b[\s\S]*?<\/office:annotation>/g)) {
      const author = textOf(m[0], 'dc:creator');
      addPerson(author);
      out.comments.push({ author, text: textOf(m[0], 'text:p') });
    }
    for (const m of content.matchAll(/<text:changed-region\b[\s\S]*?<\/text:changed-region>/g)) {
      const author = textOf(m[0], 'dc:creator');
      addPerson(author);
      const type = /<text:deletion>/.test(m[0]) ? 'del' : 'ins';
      out.changes.push({
        type,
        author,
        date: textOf(m[0], 'dc:date') || null,
        text: textOf(m[0], 'text:p'),
      });
    }
  }

  out.people = [...people];
  out.paths = [...paths];
  return out;
}

export interface CleanOptions {
  /** Word: accept all tracked changes (deleted text is gone for good). */
  acceptChanges: boolean;
  /** Word: delete comments. */
  removeComments: boolean;
  /** Word: delete hidden text. */
  removeHidden: boolean;
}

const ANON = 'Autor';

function cleanCore(xml: string): string {
  return xml
    .replace(/<dc:creator>[^<]*<\/dc:creator>/g, '<dc:creator></dc:creator>')
    .replace(
      /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/g,
      '<cp:lastModifiedBy></cp:lastModifiedBy>',
    )
    .replace(/<cp:lastPrinted>[^<]*<\/cp:lastPrinted>/g, '')
    .replace(/<cp:revision>[^<]*<\/cp:revision>/g, '<cp:revision>1</cp:revision>')
    .replace(/<dc:description>[^<]*<\/dc:description>/g, '');
}

function cleanApp(xml: string): string {
  return xml
    .replace(/<Company>[^<]*<\/Company>/g, '<Company></Company>')
    .replace(/<Manager>[^<]*<\/Manager>/g, '')
    .replace(/<Template>[^<]*<\/Template>/g, '<Template>Normal.dotm</Template>')
    .replace(/<TotalTime>[^<]*<\/TotalTime>/g, '<TotalTime>0</TotalTime>')
    .replace(/<HyperlinkBase>[^<]*<\/HyperlinkBase>/g, '');
}

function cleanMetaOdf(xml: string): string {
  return xml
    .replace(/<meta:initial-creator>[^<]*<\/meta:initial-creator>/g, '')
    .replace(/<dc:creator>[^<]*<\/dc:creator>/g, '')
    .replace(/<meta:printed-by>[^<]*<\/meta:printed-by>/g, '')
    .replace(/<meta:print-date>[^<]*<\/meta:print-date>/g, '')
    .replace(
      /<meta:editing-cycles>[^<]*<\/meta:editing-cycles>/g,
      '<meta:editing-cycles>1</meta:editing-cycles>',
    )
    .replace(
      /<meta:editing-duration>[^<]*<\/meta:editing-duration>/g,
      '<meta:editing-duration>PT0S</meta:editing-duration>',
    );
}

/** Names in author fields, replaced by a neutral "Autor". */
function anonymize(xml: string, file = ''): string {
  let s = xml
    .replace(/(\s(?:w:author|w15:author|w:initials|displayName)=")[^"]*(")/g, `$1${ANON}$2`)
    .replace(/<author>[^<]*<\/author>/g, `<author>${ANON}</author>`)
    .replace(/<dc:creator>[^<]*<\/dc:creator>/g, `<dc:creator>${ANON}</dc:creator>`);
  // PowerPoint keeps comment authors as name/initials of <p:cmAuthor> (two
  // passes: each catches one of the two attributes).
  if (/commentAuthors\.xml$|authors\.xml$/.test(file))
    s = s
      .replace(/(<p\d*:(?:cmAuthor|author)\b[^>]*\s(?:name|initials)=")[^"]*(")/g, `$1${ANON}$2`)
      .replace(/(<p\d*:(?:cmAuthor|author)\b[^>]*\s(?:name|initials)=")[^"]*(")/g, `$1${ANON}$2`);
  return s;
}

function cleanWordBody(xml: string, o: CleanOptions): string {
  let s = xml.replace(/\sw:rsid\w*="[0-9A-Fa-f]+"/g, '');
  if (o.acceptChanges) {
    s = s
      .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
      .replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, '')
      .replace(/<w:(ins|moveTo)\b[^>]*>([\s\S]*?)<\/w:\1>/g, '$2')
      .replace(
        /<w:(rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|numberingChange)\b[^>]*>[\s\S]*?<\/w:\1>/g,
        '',
      )
      .replace(/<w:(ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '')
      .replace(/<w:(moveFromRange|moveToRange)(Start|End)\b[^>]*\/>/g, '');
  }
  if (o.removeComments) {
    s = s
      .replace(/<w:comment(RangeStart|RangeEnd)\b[^>]*\/>/g, '')
      .replace(
        /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
        '',
      );
  }
  if (o.removeHidden) {
    s = s.replace(
      /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:vanish\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
      '',
    );
  }
  return anonymize(s);
}

/** A copy without personal details (and, as chosen, without comments, changes, hidden text). */
export async function cleanOffice(reader: ByteReader, options: CleanOptions): Promise<Uint8Array> {
  const zip = await openZip(reader);
  const kind = kindOf(zip.names);
  if (!kind) throw new WorkshopError('broken', 'not an office document');
  const files: Zippable = {};
  for (const e of zip.entries) {
    if (e.directory) continue;
    const name = e.name;
    // The preview picture shows the first page as it was – drop it.
    if (/^docProps\/thumbnail\./i.test(name) || /^Thumbnails\//.test(name)) continue;
    let data: Uint8Array = await extractZipEntry(reader, e);
    if (/\.(xml|rels)$/i.test(name)) {
      let xml = new TextDecoder().decode(data);
      if (name === 'docProps/core.xml') xml = cleanCore(xml);
      else if (name === 'docProps/app.xml') xml = cleanApp(xml);
      else if (name === 'meta.xml') xml = cleanMetaOdf(xml);
      else if (name === '_rels/.rels')
        xml = xml.replace(/<Relationship\b[^>]*Target="docProps\/thumbnail\.[^"]*"[^>]*\/>/g, '');
      else if (name === 'word/settings.xml')
        xml = xml
          .replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, '')
          .replace(/<w:attachedTemplate\b[^>]*\/>/g, '');
      else if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name))
        xml = cleanWordBody(xml, options);
      else if (name === 'word/comments.xml' && options.removeComments)
        xml = xml.replace(/<w:comment\b[\s\S]*?<\/w:comment>/g, '');
      else if (name === 'word/_rels/settings.xml.rels')
        xml = xml.replace(/<Relationship\b[^>]*attachedTemplate[^>]*\/>/g, '');
      else if (name === 'META-INF/manifest.xml')
        xml = xml.replace(/<manifest:file-entry\b[^>]*Thumbnails\/[^>]*\/>/g, '');
      else xml = anonymize(xml, name);
      data = new TextEncoder().encode(xml);
    }
    // ODF wants its "mimetype" first and uncompressed.
    files[name] = [data, { level: name === 'mimetype' ? 0 : 6 }];
  }
  return zipSync(files);
}
