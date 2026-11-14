import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenIcon, Loader2Icon, XIcon } from 'lucide-react';
import { makeCbz, makeImageEpub, naturalSort, type ComicPage } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/features/convert/Dropzone';
import { HowItWorks } from '../SingleFile';
import { saveBlob } from '../save-blob';

const EXTS: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
};

async function pageOf(file: File): Promise<ComicPage | null> {
  const ext = EXTS[/\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''];
  if (!ext) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const page = {
      name: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      ext,
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    return page;
  } catch {
    return null;
  }
}

/** Comic-Macher – a folder of pictures as a CBZ comic or an EPUB. */
export function ComicTool() {
  const { t } = useTranslation();
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(files: File[]) {
    setBusy(true);
    const read = await Promise.all(files.map(pageOf));
    const ok = read.filter((p): p is ComicPage => p !== null);
    setSkipped((s) => s + read.length - ok.length);
    setPages((old) => naturalSort([...old, ...ok], (p) => p.name));
    setTitle((old) => old || (files[0]?.webkitRelativePath.split('/')[0] ?? ''));
    setBusy(false);
  }

  function save(kind: 'cbz' | 'epub') {
    const name = title.trim() || t('workshop.comic.defaultTitle');
    const bytes =
      kind === 'cbz' ? makeCbz(pages, name) : makeImageEpub(pages, name, crypto.randomUUID());
    saveBlob(
      new Blob([bytes as Uint8Array<ArrayBuffer>], {
        type: kind === 'cbz' ? 'application/vnd.comicbook+zip' : 'application/epub+zip',
      }),
      `${name.replace(/[<>:"/\\|?*]/g, '_')}.${kind}`,
    );
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="comic" />
      <Dropzone compact onFiles={(files) => void add(files)} />
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {skipped > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('workshop.comic.skipped', { count: skipped })}
        </p>
      )}
      {pages.length > 0 && (
        <div className="space-y-3" data-testid="comic-pages">
          <div className="max-w-md space-y-1">
            <Label htmlFor="comic-title">{t('workshop.comic.title')}</Label>
            <Input
              id="comic-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('workshop.comic.defaultTitle')}
            />
          </div>
          <p className="text-sm">{t('workshop.comic.count', { count: pages.length })}</p>
          <ol className="max-h-64 overflow-auto rounded border text-sm">
            {pages.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-2 border-b px-2 py-1">
                <span className="w-8 text-right text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-muted"
                  aria-label={t('workshop.comic.remove', { name: p.name })}
                  onClick={() => setPages(pages.filter((_, k) => k !== i))}
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save('cbz')}>
              <BookOpenIcon aria-hidden="true" />
              {t('workshop.comic.cbz')}
            </Button>
            <Button variant="outline" onClick={() => save('epub')}>
              <BookOpenIcon aria-hidden="true" />
              {t('workshop.comic.epub')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPages([]);
                setSkipped(0);
              }}
            >
              {t('workshop.comic.clear')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
