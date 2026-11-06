import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HiddenContent } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettings } from '@/features/settings/settings-store';
import { formatBytes } from '@/lib/format-bytes';
import { SingleFile } from '../SingleFile';
import type { StegoResult } from '../workshop-worker';

/** Shared hooks of the picture and the audio steganography. */

export type Medium = 'picture' | 'audio';
export type Failure = Extract<StegoResult<unknown>, { ok: false }>;
type Capacity = { plain: [number, number]; locked: [number, number] };

/**
 * Text keys: audio has its own wording where the picture text talks about
 * pixels (`workshop.audioStego.*`), everything else is shared (`workshop.stego.*`).
 */
export function useStegoText(medium: Medium) {
  const { i18n } = useTranslation();
  return (key: string) =>
    medium === 'audio' && i18n.exists(`workshop.audioStego.${key}`)
      ? `workshop.audioStego.${key}`
      : `workshop.stego.${key}`;
}

export function useErrorText(medium: Medium) {
  const { t } = useTranslation();
  const k = useStegoText(medium);
  return (f: Failure) => t(k(`errors.${f.code}`), { name: f.detail ?? '' });
}

/** An object URL for a blob that is freed again when it changes. */
export function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

export const baseName = (name: string, fallback: string) =>
  name.replace(/\.[^.]+$/, '') || fallback;

/** What to hide, the password and (expert mode) the bits – plus the room meter. */
export function useHideForm(medium: Medium) {
  const { t, i18n } = useTranslation();
  const k = useStegoText(medium);
  const expert = useSettings((s) => s.expertMode);
  const [kind, setKind] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [payload, setPayload] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [bits, setBits] = useState<1 | 2>(1);
  const usedBits: 1 | 2 = expert ? bits : 1;
  const enc = new TextEncoder();
  const size =
    kind === 'text'
      ? text
        ? enc.encode(text).length + 1
        : 0
      : payload
        ? payload.size + enc.encode(payload.name).length + 2
        : 0;
  const hasContent = kind === 'text' ? text.length > 0 : payload !== null;

  const content = async (): Promise<HiddenContent> =>
    kind === 'text' || !payload
      ? { kind: 'text', text }
      : { kind: 'file', name: payload.name, data: new Uint8Array(await payload.arrayBuffer()) };

  const roomOf = (capacity: Capacity) => capacity[password ? 'locked' : 'plain'][usedBits - 1] ?? 0;

  const fields = (room: number | null) => (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        value={kind}
        onValueChange={(v) => v && setKind(v as 'text' | 'file')}
        aria-label={t('workshop.stego.what')}
      >
        <ToggleGroupItem value="text">{t('workshop.stego.kindText')}</ToggleGroupItem>
        <ToggleGroupItem value="file">{t('workshop.stego.kindFile')}</ToggleGroupItem>
      </ToggleGroup>
      {kind === 'text' ? (
        <div className="space-y-1">
          <Label htmlFor={`${medium}-stego-text`}>{t('workshop.stego.message')}</Label>
          <textarea
            id={`${medium}-stego-text`}
            className="min-h-24 w-full rounded-md border bg-transparent p-2 text-sm"
            placeholder={t('workshop.stego.messagePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label>{t('workshop.stego.fileToHide')}</Label>
          <SingleFile file={payload} onFile={setPayload} />
          <p className="text-xs text-muted-foreground">{t('workshop.stego.noPrograms')}</p>
        </div>
      )}

      <div className="max-w-sm space-y-1">
        <Label htmlFor={`${medium}-stego-password`} className="flex items-center gap-1">
          {t('workshop.stego.password')}
          <HelpTip helpKey={k('passwordHelp')} labelKey="workshop.stego.password" />
        </Label>
        <Input
          id={`${medium}-stego-password`}
          type="password"
          autoComplete="new-password"
          placeholder={t('workshop.stego.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {expert && (
        <div className="space-y-1">
          <Label className="flex items-center gap-1">
            {t(k('bits'))}
            <HelpTip helpKey={k('bitsHelp')} effectKey={k('bitsEffect')} labelKey={k('bits')} />
          </Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(bits)}
            onValueChange={(v) => v && setBits(Number(v) as 1 | 2)}
            aria-label={t(k('bits'))}
          >
            <ToggleGroupItem value="1">{t(k('bitsOne'))}</ToggleGroupItem>
            <ToggleGroupItem value="2">{t(k('bitsTwo'))}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {room !== null && (
        <div className="space-y-1">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={room}
            aria-valuenow={Math.min(size, room)}
            aria-label={t(k('room'))}
          >
            <div
              className={`h-full ${size > room ? 'bg-destructive' : 'bg-primary'}`}
              style={{ width: `${room > 0 ? Math.min(100, (size / room) * 100) : 100}%` }}
            />
          </div>
          <p className={`text-sm ${size > room ? 'text-destructive' : 'text-muted-foreground'}`}>
            {t(size > room ? k('roomTooSmall') : k('roomUsed'), {
              used: formatBytes(size, i18n.language),
              room: formatBytes(room, i18n.language),
            })}
          </p>
        </div>
      )}
    </>
  );

  return { password, usedBits, hasContent, content, roomOf, fields };
}
