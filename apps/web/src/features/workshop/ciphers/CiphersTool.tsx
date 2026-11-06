import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRoundIcon, PlayIcon, SquareIcon } from 'lucide-react';
import {
  CIPHERS,
  atbash,
  caesar,
  crackCaesar,
  crackVigenere,
  fromBraille,
  fromMorse,
  morseTiming,
  rot13,
  toBraille,
  toMorse,
  vigenere,
  type Cipher,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWorkshopTrick } from '@/lib/use-view';
import { CopyButton } from '../CopyButton';
import { HowItWorks } from '../SingleFile';

type Direction = 'encode' | 'decode';

/** Ciphers that undo themselves: no direction to choose. */
const SELF_INVERSE: readonly Cipher[] = ['rot13', 'atbash'];

function apply(cipher: Cipher, text: string, direction: Direction, shift: number, key: string) {
  const back = direction === 'decode';
  switch (cipher) {
    case 'caesar':
      return caesar(text, back ? -shift : shift);
    case 'rot13':
      return rot13(text);
    case 'atbash':
      return atbash(text);
    case 'vigenere':
      return vigenere(text, key, back);
    case 'morse':
      return back ? fromMorse(text) : toMorse(text);
    case 'braille':
      return back ? fromBraille(text) : toBraille(text);
  }
}

/** Plays Morse code as beeps (WebAudio, 600 Hz). */
function useMorsePlayer() {
  const context = useRef<AudioContext | null>(null);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef<number | null>(null);

  const stop = () => {
    void context.current?.close();
    context.current = null;
    if (stopAt.current) window.clearTimeout(stopAt.current);
    setPlaying(false);
  };
  useEffect(() => stop, []);

  const play = (code: string) => {
    stop();
    const ctx = new AudioContext();
    context.current = ctx;
    const unit = 0.08;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const tone = ctx.createOscillator();
    tone.frequency.value = 600;
    tone.connect(gain);
    let time = ctx.currentTime + 0.05;
    for (const step of morseTiming(code)) {
      const length = step.units * unit;
      if (step.on) {
        // Short ramps, so the beeps don't click.
        gain.gain.setTargetAtTime(0.3, time, 0.005);
        gain.gain.setTargetAtTime(0, time + length, 0.005);
      }
      time += length;
    }
    tone.start();
    tone.stop(time + 0.1);
    setPlaying(true);
    stopAt.current = window.setTimeout(stop, (time - ctx.currentTime + 0.2) * 1000);
  };
  return { playing, play, stop };
}

function CrackCaesar({ text, onPick }: { text: string; onPick: (shift: number) => void }) {
  const { t } = useTranslation();
  const candidates = useMemo(() => crackCaesar(text).slice(0, 5), [text]);
  return (
    <div className="space-y-2">
      <p className="text-sm">{t('workshop.ciphers.crack.caesarTried')}</p>
      <ol className="divide-y rounded-lg border text-sm">
        {candidates.map((c, i) => (
          <li key={c.shift} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">
              {i === 0
                ? t('workshop.ciphers.crack.bestGuess', { shift: c.shift })
                : t('workshop.ciphers.crack.shift', { shift: c.shift })}
            </span>
            <span className="min-w-0 flex-1 truncate">{c.text}</span>
            <Button variant="ghost" size="sm" onClick={() => onPick(c.shift)}>
              {t('workshop.ciphers.crack.use')}
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CrackVigenere({ text, onPick }: { text: string; onPick: (key: string) => void }) {
  const { t } = useTranslation();
  const [length, setLength] = useState('auto');
  const result = useMemo(
    () => crackVigenere(text, 12, length === 'auto' ? undefined : Number(length)),
    [text, length],
  );
  if (!result) return <p className="text-sm">{t('workshop.ciphers.crack.tooShort')}</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="cipher-key-length" className="flex items-center gap-1">
          {t('workshop.ciphers.crack.keyLength')}
          <HelpTip
            helpKey="workshop.ciphers.crack.keyLengthHelp"
            labelKey="workshop.ciphers.crack.keyLength"
          />
        </Label>
        <Select value={length} onValueChange={setLength}>
          <SelectTrigger id="cipher-key-length" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('workshop.ciphers.crack.keyLengthAuto')}</SelectItem>
            {Array.from({ length: 12 }, (_, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>
                {t('workshop.ciphers.crack.letters', { count: i + 1 })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {length === 'auto' && result.longest < 12 && (
        <p className="text-xs text-muted-foreground">
          {t('workshop.ciphers.crack.longestGuess', { count: result.longest })}
        </p>
      )}
      <p>{t('workshop.ciphers.crack.vigenereGuess', { key: result.key })}</p>
      <p className="rounded-lg border p-2 break-words whitespace-pre-wrap">{result.text}</p>
      <p className="text-xs text-muted-foreground">{t('workshop.ciphers.crack.vigenereNote')}</p>
      <Button variant="outline" size="sm" onClick={() => onPick(result.key)}>
        <KeyRoundIcon aria-hidden="true" />
        {t('workshop.ciphers.crack.useKey', { key: result.key })}
      </Button>
    </div>
  );
}

/** Geheimschrift: classic ciphers to play with – and how to crack each one. */
export function CiphersTool() {
  const { t } = useTranslation();
  const [, openTrick] = useWorkshopTrick();
  const [cipher, setCipher] = useState<Cipher>('caesar');
  const [direction, setDirection] = useState<Direction>('encode');
  const [shift, setShift] = useState(3);
  const [key, setKey] = useState('ZAUBER');
  const [input, setInput] = useState('');
  const morse = useMorsePlayer();

  const output = useMemo(
    () => apply(cipher, input, direction, shift, key),
    [cipher, input, direction, shift, key],
  );
  const morseCode = cipher === 'morse' ? (direction === 'encode' ? output : input) : '';
  const hasDirection = !SELF_INVERSE.includes(cipher);
  const crackable = cipher === 'caesar' || cipher === 'rot13' || cipher === 'vigenere';
  // Cracking works on the secret text: the output when encoding, else the input.
  const secretText = direction === 'encode' && hasDirection ? output : input;

  return (
    <div className="space-y-4">
      <HowItWorks trick="ciphers" />
      <div className="space-y-1">
        <Label>{t('workshop.ciphers.method')}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          className="flex-wrap"
          value={cipher}
          onValueChange={(v) => v && setCipher(v as Cipher)}
          aria-label={t('workshop.ciphers.method')}
        >
          {CIPHERS.map((c) => (
            <ToggleGroupItem key={c} value={c}>
              {t(`workshop.ciphers.methods.${c}.name`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-sm text-muted-foreground">
          {t(`workshop.ciphers.methods.${cipher}.help`)}
        </p>
      </div>

      {hasDirection && (
        <ToggleGroup
          type="single"
          variant="outline"
          value={direction}
          onValueChange={(v) => v && setDirection(v as Direction)}
          aria-label={t('workshop.ciphers.direction')}
        >
          <ToggleGroupItem value="encode">{t('workshop.ciphers.encode')}</ToggleGroupItem>
          <ToggleGroupItem value="decode">{t('workshop.ciphers.decode')}</ToggleGroupItem>
        </ToggleGroup>
      )}

      {cipher === 'caesar' && (
        <div className="max-w-sm space-y-2">
          <Label className="flex items-center gap-1">
            {t('workshop.ciphers.shift', { shift })}
            <HelpTip helpKey="workshop.ciphers.shiftHelp" labelKey="workshop.ciphers.shiftLabel" />
          </Label>
          <Slider
            min={1}
            max={25}
            step={1}
            value={[shift]}
            onValueChange={(v) => setShift(v[0] ?? 3)}
            aria-label={t('workshop.ciphers.shiftLabel')}
          />
        </div>
      )}
      {cipher === 'vigenere' && (
        <div className="max-w-sm space-y-1">
          <Label htmlFor="cipher-key" className="flex items-center gap-1">
            {t('workshop.ciphers.key')}
            <HelpTip helpKey="workshop.ciphers.keyHelp" labelKey="workshop.ciphers.key" />
          </Label>
          <Input
            id="cipher-key"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cipher-input">{t('workshop.ciphers.input')}</Label>
          <textarea
            id="cipher-input"
            className="min-h-32 w-full rounded-md border bg-transparent p-2 text-sm"
            placeholder={t(
              hasDirection && direction === 'decode'
                ? 'workshop.ciphers.inputSecret'
                : 'workshop.ciphers.inputPlain',
            )}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="cipher-output" className="flex-1">
              {t('workshop.ciphers.output')}
            </Label>
            {cipher === 'morse' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!morseCode.trim()}
                onClick={() => (morse.playing ? morse.stop() : morse.play(morseCode))}
              >
                {morse.playing ? (
                  <SquareIcon aria-hidden="true" />
                ) : (
                  <PlayIcon aria-hidden="true" />
                )}
                {t(morse.playing ? 'workshop.ciphers.stop' : 'workshop.ciphers.play')}
              </Button>
            )}
            <CopyButton text={output} label={t('workshop.ciphers.copy')} />
          </div>
          <textarea
            id="cipher-output"
            readOnly
            className={`min-h-32 w-full rounded-md border bg-muted/30 p-2 ${
              cipher === 'braille' ? 'text-xl leading-relaxed' : 'text-sm'
            } ${cipher === 'morse' && direction === 'encode' ? 'font-mono' : ''}`}
            value={output}
          />
        </div>
      </div>

      <section className="space-y-2 rounded-lg border p-3">
        <h3 className="font-medium">{t('workshop.ciphers.crack.title')}</h3>
        <p className="text-sm leading-relaxed">{t(`workshop.ciphers.methods.${cipher}.crack`)}</p>
        {crackable && secretText.replace(/[^A-Za-z]/g, '').length >= 20 ? (
          cipher === 'vigenere' ? (
            <CrackVigenere
              text={secretText}
              onPick={(k) => {
                setKey(k);
                setDirection('decode');
                setInput(secretText);
              }}
            />
          ) : (
            <CrackCaesar
              text={secretText}
              onPick={(s) => {
                setCipher('caesar');
                setShift(s);
                setDirection('decode');
                setInput(secretText);
              }}
            />
          )
        ) : (
          crackable && (
            <p className="text-sm text-muted-foreground">{t('workshop.ciphers.crack.typeMore')}</p>
          )
        )}
      </section>

      <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <span className="flex-1">{t('workshop.ciphers.notSafe')}</span>
        <Button variant="outline" size="sm" onClick={() => openTrick('vault')}>
          <KeyRoundIcon aria-hidden="true" />
          {t('workshop.ciphers.toVault')}
        </Button>
      </p>
    </div>
  );
}
