import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeIcon, Loader2Icon, LockOpenIcon } from 'lucide-react';
import type { HiddenContent } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyButton } from '../CopyButton';
import { saveBlob } from '../save-blob';
import type { Medium } from './use-stego';

/** Shared parts of the picture and the audio steganography. */

/** The password form for a locked message. */
export function OpenWithPassword({
  medium,
  busy,
  onOpen,
  intro = true,
}: {
  medium: Medium;
  busy: boolean;
  onOpen: (password: string) => void;
  /** The "a message is hidden here" line (off when the caller says it itself). */
  intro?: boolean;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex max-w-md flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(password);
      }}
    >
      {intro && (
        <p className="w-full text-sm" role="status">
          {t('workshop.stego.lockedFound')}
        </p>
      )}
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor={`${medium}-stego-open-password`}>{t('workshop.stego.openPassword')}</Label>
        <Input
          id={`${medium}-stego-open-password`}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!password || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <LockOpenIcon aria-hidden="true" />
        )}
        {t('workshop.stego.open')}
      </Button>
    </form>
  );
}

/** What was found: a text to read and copy, or a file to save. */
export function FoundContent({ content }: { content: HiddenContent }) {
  const { t } = useTranslation();
  if (content.kind === 'text') {
    return (
      <section className="space-y-1 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex flex-1 items-center gap-2 font-medium">
            <EyeIcon className="size-4" aria-hidden="true" />
            {t('workshop.stego.foundText')}
          </h3>
          <CopyButton text={content.text} label={t('workshop.stego.copy')} />
        </div>
        <p className="text-sm break-words whitespace-pre-wrap">{content.text}</p>
      </section>
    );
  }
  return (
    <section className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
      <h3 className="font-medium">{t('workshop.stego.foundFile', { name: content.name })}</h3>
      <Button
        onClick={() => saveBlob(new Blob([content.data.slice()]), content.name || 'versteckt.bin')}
      >
        <DownloadIcon aria-hidden="true" />
        {t('workshop.stego.saveFound', { name: content.name })}
      </Button>
    </section>
  );
}
