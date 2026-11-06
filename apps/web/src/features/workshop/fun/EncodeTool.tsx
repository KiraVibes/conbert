import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  TEXT_CODECS,
  bytesToBase64,
  bytesToHex,
  dataUri,
  decodeAny,
  decodeText,
  encodeText,
  type TextCodec,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { detectFileType } from '@/lib/detect-type';
import { formatBytes } from '@/lib/format-bytes';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

const TEXTAREA = 'min-h-32 w-full rounded-md border bg-transparent p-2 font-mono text-sm';
/** Bigger files make the page slow as text – and nobody pastes 50 MB of Base64. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Only this much is shown; copying and saving still give everything. */
const SHOWN_CHARS = 200_000;

type FileFormat = 'base64' | 'datauri' | 'hex';

/** Kodieren & Dekodieren: Base64, hex, URL encoding and data URIs. */
export function EncodeTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="encode" />
      <Tabs defaultValue="text" className="gap-4">
        <TabsList>
          <TabsTrigger value="text">{t('workshop.encode.textTab')}</TabsTrigger>
          <TabsTrigger value="toText">{t('workshop.encode.fileTab')}</TabsTrigger>
          <TabsTrigger value="toFile">{t('workshop.encode.backTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="text" forceMount className="data-[state=inactive]:hidden">
          <TextCoder />
        </TabsContent>
        <TabsContent value="toText" forceMount className="data-[state=inactive]:hidden">
          <FileToText />
        </TabsContent>
        <TabsContent value="toFile" forceMount className="data-[state=inactive]:hidden">
          <TextToFile />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TextCoder() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [codec, setCodec] = useState<TextCodec>('base64');
  const [direction, setDirection] = useState<'encode' | 'decode'>('encode');
  const decoded = direction === 'decode' && input ? decodeText(input, codec) : null;
  const output =
    direction === 'encode'
      ? input
        ? encodeText(input, codec)
        : ''
      : decoded?.ok
        ? decoded.text
        : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="encode-codec" className="flex items-center gap-1">
            {t('workshop.encode.codec')}
            <HelpTip helpKey="workshop.encode.codecHelp" labelKey="workshop.encode.codec" />
          </Label>
          <Select value={codec} onValueChange={(v) => setCodec(v as TextCodec)}>
            <SelectTrigger id="encode-codec" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_CODECS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`workshop.encode.codecs.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={direction}
          onValueChange={(v) => v && setDirection(v as 'encode' | 'decode')}
          aria-label={t('workshop.encode.direction')}
        >
          <ToggleGroupItem value="encode">{t('workshop.encode.encode')}</ToggleGroupItem>
          <ToggleGroupItem value="decode">{t('workshop.encode.decode')}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="encode-input">
            {t(direction === 'encode' ? 'workshop.encode.plain' : 'workshop.encode.encoded')}
          </Label>
          <textarea
            id="encode-input"
            className={TEXTAREA}
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="encode-output">
            {t(direction === 'encode' ? 'workshop.encode.encoded' : 'workshop.encode.plain')}
          </Label>
          <textarea id="encode-output" className={TEXTAREA} readOnly value={output} />
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={output} label={t('workshop.qr.copy')} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!output}
              onClick={() => {
                setInput(output);
                setDirection(direction === 'encode' ? 'decode' : 'encode');
              }}
            >
              {t('workshop.encode.swap')}
            </Button>
          </div>
        </div>
      </div>
      {decoded && !decoded.ok && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {t(decoded.reason === 'binary' ? 'workshop.encode.binary' : 'workshop.encode.invalid')}
        </p>
      )}
    </div>
  );
}

function FileToText() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<FileFormat>('base64');
  const [text, setText] = useState<{ key: string; value: string } | null>(null);
  const tooBig = file !== null && file.size > MAX_FILE_BYTES;
  const key = file ? `${file.name}-${file.size}-${format}` : '';

  useEffect(() => {
    if (!file || tooBig) return;
    let active = true;
    void file.arrayBuffer().then((buffer) => {
      if (!active) return;
      const bytes = new Uint8Array(buffer);
      const value =
        format === 'hex'
          ? bytesToHex(bytes, true)
          : format === 'datauri'
            ? dataUri(bytes, file.type || 'application/octet-stream')
            : bytesToBase64(bytes);
      setText({ key, value });
    });
    return () => {
      active = false;
    };
  }, [file, format, key, tooBig]);

  const value = text?.key === key ? text.value : '';
  const base = file?.name.replace(/\.[^.]+$/, '') || 'file';

  return (
    <div className="space-y-3">
      <SingleFile file={file} onFile={setFile} />
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          {t('workshop.encode.format')}
          <HelpTip helpKey="workshop.encode.formatHelp" labelKey="workshop.encode.format" />
        </Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={format}
          onValueChange={(v) => v && setFormat(v as FileFormat)}
        >
          <ToggleGroupItem value="base64">Base64</ToggleGroupItem>
          <ToggleGroupItem value="datauri">Data-URI</ToggleGroupItem>
          <ToggleGroupItem value="hex">Hex</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {tooBig && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.encode.tooBig', { max: formatBytes(MAX_FILE_BYTES, i18n.language) })}
        </p>
      )}
      {value && (
        <>
          <textarea
            className={TEXTAREA}
            readOnly
            aria-label={t('workshop.encode.result')}
            value={value.length > SHOWN_CHARS ? `${value.slice(0, SHOWN_CHARS)} …` : value}
          />
          <p className="text-xs text-muted-foreground">
            {t('workshop.encode.length', { count: value.length })}
            {value.length > SHOWN_CHARS && ` ${t('workshop.encode.cut')}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={value} label={t('workshop.qr.copy')} />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                saveBlob(new Blob([value], { type: 'text/plain' }), `${base}.${format}.txt`)
              }
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.encode.saveTxt')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/html': 'html',
  'application/json': 'json',
};

function TextToFile() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState('');
  const [ext, setExt] = useState<{ input: string; ext: string } | null>(null);
  const decoded = input.trim() ? decodeAny(input) : null;

  // What the bytes are, from their first bytes (a PNG stays a PNG).
  useEffect(() => {
    if (!decoded) return;
    let active = true;
    const probe = new File([decoded.bytes as Uint8Array<ArrayBuffer>], 'decoded');
    void detectFileType(probe).then(
      (type) =>
        active && setExt({ input, ext: type.detectedExt ?? MIME_EXT[decoded.mime ?? ''] ?? 'bin' }),
    );
    return () => {
      active = false;
    };
    // `decoded` is derived from `input`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const fileExt = ext?.input === input ? ext.ext : null;

  return (
    <div className="space-y-3">
      <Label htmlFor="encode-paste">{t('workshop.encode.paste')}</Label>
      <textarea
        id="encode-paste"
        className={TEXTAREA}
        spellCheck={false}
        placeholder="data:image/png;base64,iVBORw0KGgo…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {input.trim() && !decoded && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {t('workshop.encode.invalid')}
        </p>
      )}
      {decoded && fileExt && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {t('workshop.encode.found', {
              from: t(`workshop.encode.from.${decoded.from}`),
              ext: fileExt.toUpperCase(),
              size: formatBytes(decoded.bytes.length, i18n.language),
            })}
          </p>
          <Button
            size="sm"
            onClick={() =>
              saveBlob(
                new Blob([decoded.bytes as Uint8Array<ArrayBuffer>], {
                  type: decoded.mime ?? 'application/octet-stream',
                }),
                `decoded.${fileExt}`,
              )
            }
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.encode.saveFile')}
          </Button>
        </div>
      )}
    </div>
  );
}
