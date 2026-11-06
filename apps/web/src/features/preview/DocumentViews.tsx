import { useEffect, useState } from 'react';
import { FileTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ImagePreview } from './ImagePreview';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import { TEXT_DOCUMENTS, type PreviewSource } from './preview-source';
import { sanitizeHtmlDocument, sanitizeSvg } from './sanitize';
import { useDisplayUrl } from './use-display-url';

/** Highlighting is only worth it (and fast) for reasonably small texts. */
const MAX_TEXT = 256 * 1024;

const LANGUAGE: Record<string, string> = {
  md: 'markdown',
  html: 'html',
  tex: 'latex',
  rst: 'rst',
  org: 'org',
  svg: 'xml',
  txt: 'text',
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
};

/** HTML in a sandboxed iframe: no scripts, no network, no access to Conbert. */
export function HtmlFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={sanitizeHtmlDocument(html)}
      className="h-[60vh] w-full rounded-md border bg-white"
      data-testid="html-preview"
    />
  );
}

/** Pandoc → HTML (for Word, OpenDocument, EPUB …), then the sandboxed frame. */
export function DocumentPreview({ source }: { source: PreviewSource }) {
  const display = useDisplayUrl(source, 'document');
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (display.status === 'ready') void display.blob.text().then(setHtml);
  }, [display]);
  if (display.status === 'loading')
    return <PreviewLoading state={display} hintKey="preview.documentHint" />;
  if (display.status === 'error') return <PreviewProblem state={display} />;
  if (html === null)
    return <PreviewLoading state={{ status: 'loading', progress: 100, converting: false }} />;
  return <HtmlFrame html={html} title={source.name} />;
}

export function HtmlPreview({ source }: { source: PreviewSource }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    void source.blob.text().then(setHtml);
  }, [source]);
  if (html === null)
    return <PreviewLoading state={{ status: 'loading', progress: 0, converting: false }} />;
  return <HtmlFrame html={html} title={source.name} />;
}

export function SvgPreview({ source }: { source: PreviewSource }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    void source.blob.text().then((text) => {
      if (cancelled) return;
      created = URL.createObjectURL(new Blob([sanitizeSvg(text)], { type: 'image/svg+xml' }));
      setUrl(created);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [source]);
  if (!url) return <PreviewLoading state={{ status: 'loading', progress: 0, converting: false }} />;
  return <ImagePreview url={url} alt={source.name} />;
}

/** Highlighted source text; Markdown & co. can also be shown as a document. */
export function TextPreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const full = await source.blob.text();
      const text = full.slice(0, MAX_TEXT);
      const dark = document.documentElement.classList.contains('dark');
      const { codeToHtml } = await import('shiki');
      const html = await codeToHtml(text, {
        lang: LANGUAGE[source.ext] ?? 'text',
        theme: dark ? 'github-dark' : 'github-light',
      });
      if (!cancelled) {
        setTruncated(full.length > MAX_TEXT);
        setHighlighted(html);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const canRender = TEXT_DOCUMENTS.has(source.ext) && source.ext !== 'txt';
  return (
    <div className="space-y-2">
      {canRender && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setRendered((r) => !r)}>
            <FileTextIcon aria-hidden="true" />
            {t(rendered ? 'preview.showSource' : 'preview.showRendered')}
          </Button>
        </div>
      )}
      {rendered ? (
        <DocumentPreview source={source} />
      ) : highlighted === null ? (
        <PreviewLoading state={{ status: 'loading', progress: 0, converting: false }} />
      ) : (
        <div
          className="h-[60vh] overflow-auto rounded-md border text-sm [&_pre]:min-h-full [&_pre]:p-4 [&_pre]:whitespace-pre-wrap"
          data-testid="text-preview"
          // Shiki escapes the text; the markup only adds colours.
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      )}
      {truncated && <p className="text-sm text-muted-foreground">{t('preview.truncated')}</p>}
    </div>
  );
}
